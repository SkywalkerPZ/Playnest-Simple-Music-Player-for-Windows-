import Database from "@tauri-apps/plugin-sql";
import { Playlist, Track } from "./types";

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:playnest.db");
  }
  return dbPromise;
}

interface TrackColumns {
  track_id: string;
  title: string;
  uploader: string;
  duration_seconds: number;
  thumbnail: string;
}

function rowToTrack(r: TrackColumns): Track {
  return {
    id: r.track_id,
    title: r.title,
    uploader: r.uploader,
    durationSeconds: r.duration_seconds,
    thumbnail: r.thumbnail,
  };
}

// --- playlists ---

interface PlaylistRow {
  id: number;
  name: string;
  created_at: string;
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  const db = await getDb();
  const rows = await db.select<PlaylistRow[]>(
    "SELECT id, name, created_at FROM playlists ORDER BY created_at DESC"
  );
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export async function createPlaylist(name: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO playlists (name, created_at) VALUES ($1, $2)",
    [name, new Date().toISOString()]
  );
  return result.lastInsertId as number;
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE playlists SET name = $1 WHERE id = $2", [name, id]);
}

export async function deletePlaylist(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM playlist_tracks WHERE playlist_id = $1", [id]);
  await db.execute("DELETE FROM playlists WHERE id = $1", [id]);
}

export async function fetchPlaylistTracks(playlistId: number): Promise<Track[]> {
  const db = await getDb();
  const rows = await db.select<TrackColumns[]>(
    "SELECT track_id, title, uploader, duration_seconds, thumbnail FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC",
    [playlistId]
  );
  return rows.map(rowToTrack);
}

/** Rows per INSERT statement — keeps each statement well under SQLite's
 * bound-parameter limit (7 parameters per track). */
const INSERT_CHUNK = 100;

async function insertPlaylistTracks(
  db: Database,
  playlistId: number,
  tracks: Track[],
  startPosition: number
): Promise<void> {
  for (let i = 0; i < tracks.length; i += INSERT_CHUNK) {
    const chunk = tracks.slice(i, i + INSERT_CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk.map((t, j) => {
      const b = j * 7;
      values.push(
        playlistId,
        startPosition + i + j,
        t.id,
        t.title,
        t.uploader,
        t.durationSeconds,
        t.thumbnail
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await db.execute(
      `INSERT INTO playlist_tracks
        (playlist_id, position, track_id, title, uploader, duration_seconds, thumbnail)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  }
}

function dedupeById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** Append tracks to a playlist, skipping any already in it. */
export async function addTracksToPlaylist(
  playlistId: number,
  tracks: Track[]
): Promise<number> {
  const db = await getDb();
  const existing = await db.select<{ track_id: string }[]>(
    "SELECT track_id FROM playlist_tracks WHERE playlist_id = $1",
    [playlistId]
  );
  const existingIds = new Set(existing.map((r) => r.track_id));
  const toAdd = dedupeById(tracks).filter((t) => !existingIds.has(t.id));
  if (toAdd.length === 0) return 0;

  const maxPos = await db.select<{ max_pos: number | null }[]>(
    "SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = $1",
    [playlistId]
  );
  await insertPlaylistTracks(db, playlistId, toAdd, (maxPos[0]?.max_pos ?? -1) + 1);
  return toAdd.length;
}

export async function addTrackToPlaylist(playlistId: number, track: Track): Promise<void> {
  await addTracksToPlaylist(playlistId, [track]);
}

/** Replace a playlist's contents with `tracks`, in that order (used for
 * drag-to-reorder). */
export async function replacePlaylistTracks(
  playlistId: number,
  tracks: Track[]
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM playlist_tracks WHERE playlist_id = $1", [playlistId]);
  await insertPlaylistTracks(db, playlistId, dedupeById(tracks), 0);
}

export async function removeTrackFromPlaylist(
  playlistId: number,
  trackId: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
    [playlistId, trackId]
  );
}

// --- key/value app state ---

export async function saveAppState(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)]
  );
}

export async function loadAppState<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_state WHERE key = $1",
    [key]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return null;
  }
}

// --- play log (Recently Played, Stats, Suggestions) ---

/** How many plays to keep. Large enough for a meaningful Stats page while
 * staying tiny on disk (a few hundred bytes per play). */
const PLAY_LOG_LIMIT = 5000;

export async function recordRecentlyPlayed(track: Track): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO recently_played
      (track_id, title, uploader, duration_seconds, thumbnail, played_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      track.id,
      track.title,
      track.uploader,
      track.durationSeconds,
      track.thumbnail,
      new Date().toISOString(),
    ]
  );
  await db.execute(
    `DELETE FROM recently_played WHERE id NOT IN (
       SELECT id FROM recently_played ORDER BY played_at DESC LIMIT $1
     )`,
    [PLAY_LOG_LIMIT]
  );
}

export async function fetchRecentlyPlayed(limit = 100): Promise<Track[]> {
  const db = await getDb();
  const rows = await db.select<TrackColumns[]>(
    `SELECT track_id, title, uploader, duration_seconds, thumbnail
     FROM recently_played ORDER BY played_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(rowToTrack);
}

export interface PlayLogEntry {
  track: Track;
  playedAt: string;
}

export async function fetchPlayLog(): Promise<PlayLogEntry[]> {
  const db = await getDb();
  const rows = await db.select<(TrackColumns & { played_at: string })[]>(
    `SELECT track_id, title, uploader, duration_seconds, thumbnail, played_at
     FROM recently_played ORDER BY played_at DESC`
  );
  return rows.map((r) => ({ track: rowToTrack(r), playedAt: r.played_at }));
}

// --- search history (feeds Suggestions) ---

export async function recordSearchQuery(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) return;
  const db = await getDb();
  await db.execute(
    "INSERT INTO search_history (query, searched_at) VALUES ($1, $2)",
    [trimmed, new Date().toISOString()]
  );
  await db.execute(
    `DELETE FROM search_history WHERE id NOT IN (
       SELECT id FROM search_history ORDER BY searched_at DESC LIMIT 200
     )`
  );
}

export async function fetchSearchHistory(limit = 50): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ query: string }[]>(
    "SELECT query FROM search_history ORDER BY searched_at DESC LIMIT $1",
    [limit]
  );
  return rows.map((r) => r.query);
}

/** Distinct recent searches, newest first (case-insensitive dedupe). */
export async function fetchRecentSearches(limit = 8): Promise<string[]> {
  const all = await fetchSearchHistory(100);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const q of all) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(q);
    if (result.length >= limit) break;
  }
  return result;
}

export async function deleteSearchQuery(query: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM search_history WHERE lower(query) = lower($1)", [query]);
}

export async function clearSearchHistory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM search_history");
}

// --- liked songs ---

export async function likeTrack(track: Track): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO liked_tracks
      (track_id, title, uploader, duration_seconds, thumbnail, liked_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      track.id,
      track.title,
      track.uploader,
      track.durationSeconds,
      track.thumbnail,
      new Date().toISOString(),
    ]
  );
}

export async function unlikeTrack(trackId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM liked_tracks WHERE track_id = $1", [trackId]);
}

export async function fetchLikedTracks(): Promise<Track[]> {
  const db = await getDb();
  const rows = await db.select<TrackColumns[]>(
    `SELECT track_id, title, uploader, duration_seconds, thumbnail
     FROM liked_tracks ORDER BY liked_at DESC`
  );
  return rows.map(rowToTrack);
}

// --- downloads ---

export interface DownloadedTrack {
  track: Track;
  filePath: string;
}

export async function recordDownload(track: Track, filePath: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO downloads
      (track_id, title, uploader, duration_seconds, thumbnail, file_path, downloaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      track.id,
      track.title,
      track.uploader,
      track.durationSeconds,
      track.thumbnail,
      filePath,
      new Date().toISOString(),
    ]
  );
}

export async function removeDownloadRecord(trackId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM downloads WHERE track_id = $1", [trackId]);
}

export async function fetchDownloads(): Promise<DownloadedTrack[]> {
  const db = await getDb();
  const rows = await db.select<(TrackColumns & { file_path: string })[]>(
    `SELECT track_id, title, uploader, duration_seconds, thumbnail, file_path
     FROM downloads ORDER BY downloaded_at DESC`
  );
  return rows.map((r) => ({ track: rowToTrack(r), filePath: r.file_path }));
}

// --- backup / restore ---

/** Insert many rows with one statement per chunk. `columns` is the column
 * list; each row supplies values in that order. */
async function insertMany(
  db: Database,
  statementStart: string,
  columnCount: number,
  rows: unknown[][]
): Promise<void> {
  const perChunk = Math.max(1, Math.floor(900 / columnCount));
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const values: unknown[] = [];
    const placeholders = chunk.map((row, j) => {
      values.push(...row);
      const base = j * columnCount;
      return `(${row.map((_, k) => `$${base + k + 1}`).join(", ")})`;
    });
    await db.execute(`${statementStart} VALUES ${placeholders.join(", ")}`, values);
  }
}

const trackValues = (t: Track) => [t.id, t.title, t.uploader, t.durationSeconds, t.thumbnail];

export async function fetchLikedWithDates(): Promise<{ track: Track; likedAt: string }[]> {
  const db = await getDb();
  const rows = await db.select<(TrackColumns & { liked_at: string })[]>(
    `SELECT track_id, title, uploader, duration_seconds, thumbnail, liked_at
     FROM liked_tracks ORDER BY liked_at DESC`
  );
  return rows.map((r) => ({ track: rowToTrack(r), likedAt: r.liked_at }));
}

export async function fetchSearchHistoryWithDates(): Promise<{ query: string; searchedAt: string }[]> {
  const db = await getDb();
  const rows = await db.select<{ query: string; searched_at: string }[]>(
    "SELECT query, searched_at FROM search_history ORDER BY searched_at DESC"
  );
  return rows.map((r) => ({ query: r.query, searchedAt: r.searched_at }));
}

/** Add likes that aren't already there. Returns how many were added. */
export async function restoreLikes(entries: { track: Track; likedAt: string }[]): Promise<number> {
  const db = await getDb();
  const existing = new Set(
    (await db.select<{ track_id: string }[]>("SELECT track_id FROM liked_tracks")).map((r) => r.track_id)
  );
  const fresh = entries.filter((e) => !existing.has(e.track.id) && (existing.add(e.track.id), true));
  await insertMany(
    db,
    "INSERT OR IGNORE INTO liked_tracks (track_id, title, uploader, duration_seconds, thumbnail, liked_at)",
    6,
    fresh.map((e) => [...trackValues(e.track), e.likedAt])
  );
  return fresh.length;
}

/** Add plays that aren't already logged (same track at the same moment
 * counts as the same play), then trim to the usual limit. */
export async function restorePlays(entries: PlayLogEntry[]): Promise<number> {
  const db = await getDb();
  const existing = new Set(
    (await db.select<{ track_id: string; played_at: string }[]>("SELECT track_id, played_at FROM recently_played")).map(
      (r) => `${r.track_id}|${r.played_at}`
    )
  );
  const fresh = entries.filter((e) => {
    const key = `${e.track.id}|${e.playedAt}`;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  await insertMany(
    db,
    "INSERT INTO recently_played (track_id, title, uploader, duration_seconds, thumbnail, played_at)",
    6,
    fresh.map((e) => [...trackValues(e.track), e.playedAt])
  );
  await db.execute(
    `DELETE FROM recently_played WHERE id NOT IN (
       SELECT id FROM recently_played ORDER BY played_at DESC LIMIT $1
     )`,
    [PLAY_LOG_LIMIT]
  );
  return fresh.length;
}

export async function restoreSearches(entries: { query: string; searchedAt: string }[]): Promise<number> {
  const db = await getDb();
  const existing = new Set(
    (await db.select<{ query: string; searched_at: string }[]>("SELECT query, searched_at FROM search_history")).map(
      (r) => `${r.query}|${r.searched_at}`
    )
  );
  const fresh = entries.filter((e) => {
    const key = `${e.query}|${e.searchedAt}`;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  await insertMany(db, "INSERT INTO search_history (query, searched_at)", 2, fresh.map((e) => [e.query, e.searchedAt]));
  return fresh.length;
}

// --- onboarding (welcome page) ---

export async function hasCompletedOnboarding(): Promise<boolean> {
  const value = await loadAppState<boolean>("onboardingComplete");
  return value === true;
}

export async function markOnboardingComplete(): Promise<void> {
  await saveAppState("onboardingComplete", true);
}

export async function resetOnboarding(): Promise<void> {
  await saveAppState("onboardingComplete", false);
}
