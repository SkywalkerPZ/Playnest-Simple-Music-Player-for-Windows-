import { Track } from "./types";

/** Words that mark a bracketed/piped chunk of a YouTube title as noise
 * rather than part of the song name. "Live at ..." is deliberately NOT here:
 * it tells you which version you're hearing. */
const JUNK =
  /\b(official|music\s*video|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|8k|1080p|720p|remaster(ed)?|explicit|clean\s*version|mv|m\/v|color\s*coded|full\s*hd|high\s*quality)\b/i;

/** Matches "(...)", "[...]" and "【...】" groups. */
const BRACKETED = /\s*(\([^()]*\)|\[[^[\]]*\]|【[^【】]*】)/g;

/** "ft. X", "feat. X", "featuring X" through the end of the string. */
const FEATURING = /\s*[([]?\s*\b(ft\.?|feat\.?|featuring)\s+[^)\]]*[)\]]?/i;

/** Separators YouTube uploaders use between artist and song. */
const ARTIST_SONG_SEPARATOR = /\s+[-–—]\s+/;

function stripJunk(text: string): string {
  let result = text.replace(BRACKETED, (group) => (JUNK.test(group) ? "" : group));

  // "Song | Official Video" / "Song | Live at X": drop only the junk parts.
  const pieces = result.split(/\s+\|\s+/);
  if (pieces.length > 1) {
    result = [pieces[0], ...pieces.slice(1).filter((p) => !JUNK.test(p))].join(" | ");
  }

  return result.replace(/\s{2,}/g, " ").trim();
}

/** Clean an uploader name into something that reads like an artist:
 * "Mobb Deep - Topic" → "Mobb Deep", "MobbDeepVEVO" → "MobbDeep",
 * "Mobb Deep and 4 more" → "Mobb Deep". */
function cleanUploader(uploader: string): string {
  return uploader
    .replace(/\s+-\s+Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s+and\s+\d+\s+more$/i, "")
    .replace(/\s+(official|oficial)$/i, "")
    .trim();
}

export interface CleanTrack {
  /** Song name for display (keeps "ft. X" and "Live at ..."). */
  title: string;
  /** Best guess at the artist. */
  artist: string;
  /** Title with featured artists removed, best for lyrics lookups. */
  lyricsTitle: string;
}

/** Turns a raw YouTube-style title into display-friendly parts.
 * "Mobb Deep - It's Mine (Official Video) ft. Nas" →
 *   { title: "It's Mine ft. Nas", artist: "Mobb Deep", lyricsTitle: "It's Mine" }
 * Raw data is never modified; this is display-only. */
export function cleanTrack(track: Pick<Track, "title" | "uploader">): CleanTrack {
  const stripped = stripJunk(track.title);
  const fallbackArtist = cleanUploader(track.uploader);

  let artist = fallbackArtist;
  let title = stripped;

  const parts = stripped.split(ARTIST_SONG_SEPARATOR);
  if (parts.length >= 2 && parts[0].length > 0 && parts[0].length <= 60) {
    artist = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  }

  if (!title) title = stripped || track.title;
  if (!artist) artist = track.uploader;

  const lyricsTitle =
    title
      .replace(FEATURING, "")
      .replace(BRACKETED, "")
      .replace(/\s+\|.*$/, "")
      .trim() || title;

  return { title, artist, lyricsTitle };
}

/** Longer than this is almost always a full album, concert or mix. */
export const MAX_SONG_SECONDS = 15 * 60;

/** True for normal song-length tracks. Unknown length (0) usually means a
 * live stream, so it doesn't count. */
export function looksLikeSong(track: Pick<Track, "durationSeconds">): boolean {
  return track.durationSeconds > 0 && track.durationSeconds <= MAX_SONG_SECONDS;
}

/** Normalized artist key for grouping ("Mobb Deep" and "mobb deep" count as one). */
export function artistKey(artist: string): string {
  return artist.toLowerCase().replace(/\s+/g, " ").trim();
}
