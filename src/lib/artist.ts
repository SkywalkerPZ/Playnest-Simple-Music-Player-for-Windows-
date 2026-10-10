import { invoke } from "@tauri-apps/api/core";
import { fetchPlayLog } from "./db";
import { artistKey, cleanTrack, looksLikeSong } from "./titles";
import { Track } from "./types";

/** Tracks by `name` from the local play log, most-played first. */
export async function fetchYourArtistTracks(
  name: string,
  limit = 10
): Promise<{ track: Track; plays: number }[]> {
  const key = artistKey(name);
  const counts = new Map<string, { track: Track; plays: number }>();
  for (const { track } of await fetchPlayLog()) {
    if (artistKey(cleanTrack(track).artist) !== key) continue;
    const entry = counts.get(track.id) ?? { track, plays: 0 };
    entry.plays++;
    counts.set(track.id, entry);
  }
  return [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
}

/** Song-length search results for `name` that look like they're actually
 * by that artist, with duplicate uploads of the same song removed. If the
 * strict artist match finds very little (unusual names, channels that
 * don't put the artist in titles), falls back to all song-length results. */
export async function searchArtistSongs(name: string): Promise<Track[]> {
  const results = await invoke<Track[]>("search_tracks", { query: name, offset: 0, limit: 30 });
  const key = artistKey(name);
  const songs = results.filter(looksLikeSong);
  const byArtist = songs.filter((t) => artistKey(cleanTrack(t).artist).includes(key));
  const chosen = byArtist.length >= 5 ? byArtist : songs;

  const seenTitles = new Set<string>();
  return chosen.filter((t) => {
    const titleKey = artistKey(cleanTrack(t).lyricsTitle);
    if (seenTitles.has(titleKey)) return false;
    seenTitles.add(titleKey);
    return true;
  });
}
