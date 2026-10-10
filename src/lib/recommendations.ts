import { invoke } from "@tauri-apps/api/core";
import { Recommendation, Track } from "./types";
import { fetchLikedTracks, fetchRecentlyPlayed, fetchSearchHistory } from "./db";
import { artistKey, cleanTrack } from "./titles";

/** Longer than this is almost always a full album, concert or hour-long mix,
 * which makes a poor suggestion or autoplay pick. */
const MAX_SUGGESTION_SECONDS = 15 * 60;

/** A liked track says more about taste than a single play does. */
const LIKE_WEIGHT = 3;

async function search(query: string): Promise<Track[]> {
  try {
    return await invoke<Track[]>("search_tracks", { query });
  } catch (err) {
    console.warn("Suggestion search failed for", query, err);
    return [];
  }
}

function isReasonableLength(track: Track): boolean {
  return track.durationSeconds <= MAX_SUGGESTION_SECONDS;
}

interface ArtistSignal {
  name: string;
  score: number;
  liked: boolean;
}

/** Rank artists by how much the user plays and likes them. Uses cleaned
 * names, so "Mobb Deep - Topic" and a "Mobb Deep - X" upload on another
 * channel count as the same artist. */
function rankArtists(played: Track[], liked: Track[]): ArtistSignal[] {
  const byKey = new Map<string, ArtistSignal>();
  const add = (track: Track, weight: number, isLike: boolean) => {
    const name = cleanTrack(track).artist;
    const key = artistKey(name);
    if (!key) return;
    const entry = byKey.get(key) ?? { name, score: 0, liked: false };
    entry.score += weight;
    entry.liked ||= isLike;
    byKey.set(key, entry);
  };
  played.forEach((t) => add(t, 1, false));
  liked.forEach((t) => add(t, LIKE_WEIGHT, true));
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

/** "More like this" picks built purely from local history: re-search around
 * the artists played/liked most and the most recent searches, skipping
 * anything already played or liked. Each pick carries a plain reason. */
export async function buildRecommendations(limit = 24): Promise<Recommendation[]> {
  const [played, liked, searches] = await Promise.all([
    fetchRecentlyPlayed(500),
    fetchLikedTracks(),
    fetchSearchHistory(8),
  ]);

  const excluded = new Set([...played, ...liked].map((t) => t.id));
  const artists = rankArtists(played, liked).slice(0, 5);
  const artistKeys = new Set(artists.map((a) => artistKey(a.name)));

  const signals = [
    ...artists.map((a) => ({
      query: a.name,
      reason: a.liked ? `Because you like ${a.name}` : `Because you listen to ${a.name}`,
    })),
    ...searches
      .filter((q) => !artistKeys.has(artistKey(q)))
      .slice(0, 4)
      .map((q) => ({ query: q, reason: `Because you searched "${q}"` })),
  ];

  const recommendations: Recommendation[] = [];
  for (const signal of signals) {
    if (recommendations.length >= limit) break;
    let added = 0;
    for (const track of await search(signal.query)) {
      if (added >= 3) break; // no single signal should dominate the list
      if (excluded.has(track.id) || !isReasonableLength(track)) continue;
      excluded.add(track.id);
      recommendations.push({ track, reason: signal.reason });
      added++;
    }
  }
  return recommendations.slice(0, limit);
}

/** Tracks to keep playing after the queue runs out, seeded by `seed`
 * (usually the track that just finished). Mostly the same artist, mixed
 * with the user's other top artists so it doesn't get stuck in one lane. */
export async function buildRadio(
  seed: Track,
  excludeIds: Set<string>,
  limit = 10
): Promise<Track[]> {
  const seedClean = cleanTrack(seed);
  const [played, liked] = await Promise.all([fetchRecentlyPlayed(300), fetchLikedTracks()]);
  const otherArtists = rankArtists(played, liked)
    .filter((a) => artistKey(a.name) !== artistKey(seedClean.artist))
    .slice(0, 2)
    .map((a) => a.name);

  const [seedResults, ...otherResults] = await Promise.all([
    search(seedClean.artist),
    ...otherArtists.map(search),
  ]);

  const seen = new Set(excludeIds);
  seen.add(seed.id);
  const seenTitles = new Set([artistKey(seedClean.lyricsTitle)]);

  const accept = (track: Track): boolean => {
    if (seen.has(track.id) || !isReasonableLength(track)) return false;
    // Skip other uploads of the same song (lyric videos, re-uploads, etc).
    const titleKey = artistKey(cleanTrack(track).lyricsTitle);
    if (seenTitles.has(titleKey)) return false;
    seen.add(track.id);
    seenTitles.add(titleKey);
    return true;
  };

  const fromSeed = seedResults.filter(accept).slice(0, Math.ceil(limit * 0.6));
  const fromOthers = otherResults.flat().filter(accept);

  // Interleave: two from the seed artist, then one from elsewhere.
  const result: Track[] = [];
  let s = 0;
  let o = 0;
  while (result.length < limit && (s < fromSeed.length || o < fromOthers.length)) {
    for (let i = 0; i < 2 && s < fromSeed.length; i++) result.push(fromSeed[s++]);
    if (o < fromOthers.length) result.push(fromOthers[o++]);
  }
  return result.slice(0, limit);
}
