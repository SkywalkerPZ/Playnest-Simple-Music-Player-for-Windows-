import { invoke } from "@tauri-apps/api/core";

export interface LyricsLine {
  time: number; // seconds
  text: string;
}

export interface Lyrics {
  synced: LyricsLine[] | null;
  plain: string | null;
  /** Length of the recording the lyrics were timed to, if known. */
  sourceDuration: number | null;
}

/** One or more leading "[mm:ss]" / "[mm:ss.xx]" timestamps. */
const LEADING_TIMESTAMPS = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/;
const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Parses LRC ("[mm:ss.xx]lyric text") into timed lines, sorted by time.
 * Handles lines that carry several timestamps (a repeated chorus written
 * once as "[00:40.00][01:52.00]text"). Metadata tags and blank lines are
 * skipped. */
function parseLrc(lrc: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const match = rawLine.trim().match(LEADING_TIMESTAMPS);
    if (!match) continue;
    const text = match[2].trim();
    if (!text) continue;
    for (const [, mm, ss, frac] of match[1].matchAll(TIMESTAMP)) {
      const time = Number(mm) * 60 + Number(ss) + (frac ? Number(`0.${frac}`) : 0);
      lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** `duration` (seconds) lets the backend pick the version of the lyrics
 * whose length matches the track being played. */
export async function fetchLyrics(
  title: string,
  artist: string,
  duration: number
): Promise<Lyrics> {
  try {
    const result = await invoke<{
      syncedLyrics: string | null;
      plainLyrics: string | null;
      sourceDuration: number | null;
    }>("get_lyrics", { title, artist, duration: duration > 0 ? duration : null });

    return {
      synced: result.syncedLyrics ? parseLrc(result.syncedLyrics) : null,
      plain: result.plainLyrics,
      sourceDuration: result.sourceDuration,
    };
  } catch (err) {
    console.warn("Lyrics fetch failed", err);
    return { synced: null, plain: null, sourceDuration: null };
  }
}
