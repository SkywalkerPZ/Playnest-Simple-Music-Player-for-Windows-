import {
  addTracksToPlaylist,
  createPlaylist,
  fetchLikedWithDates,
  fetchPlayLog,
  fetchPlaylists,
  fetchPlaylistTracks,
  fetchSearchHistoryWithDates,
  loadAppState,
  PlayLogEntry,
  restoreLikes,
  restorePlays,
  restoreSearches,
  saveAppState,
} from "./db";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from "./settings";
import { Track } from "./types";

/** Everything worth keeping, as one JSON file. Downloaded audio files are
 * not included (they can be large, and are easy to download again). */
export interface BackupFile {
  app: "playnest";
  version: 1;
  exportedAt: string;
  playlists: { name: string; createdAt: string; tracks: Track[] }[];
  liked: { track: Track; likedAt: string }[];
  plays: PlayLogEntry[];
  searches: { query: string; searchedAt: string }[];
  settings: Settings;
  lyricsOffsets: Record<string, number>;
}

export interface RestoreSummary {
  playlistsCreated: number;
  playlistsMerged: number;
  playlistTracksAdded: number;
  likesAdded: number;
  playsAdded: number;
}

export async function buildBackup(): Promise<BackupFile> {
  const playlists = await fetchPlaylists();
  const withTracks = await Promise.all(
    playlists.map(async (p) => ({ name: p.name, createdAt: p.createdAt, tracks: await fetchPlaylistTracks(p.id) }))
  );
  const [liked, plays, searches, settings, lyricsOffsets] = await Promise.all([
    fetchLikedWithDates(),
    fetchPlayLog(),
    fetchSearchHistoryWithDates(),
    loadSettings(),
    loadAppState<Record<string, number>>("lyricsOffsets"),
  ]);
  return {
    app: "playnest",
    version: 1,
    exportedAt: new Date().toISOString(),
    // Oldest first, so restoring recreates them in their original order.
    playlists: withTracks.reverse(),
    liked,
    plays,
    searches,
    settings,
    lyricsOffsets: lyricsOffsets ?? {},
  };
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `playnest-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

// --- reading a backup back in: never trust the file's shape ---

const isString = (v: unknown): v is string => typeof v === "string";

function asTrack(v: unknown): Track | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (!isString(t.id) || !isString(t.title) || !/^[A-Za-z0-9_-]{1,32}$/.test(t.id)) return null;
  return {
    id: t.id,
    title: t.title,
    uploader: isString(t.uploader) ? t.uploader : "",
    durationSeconds: typeof t.durationSeconds === "number" && Number.isFinite(t.durationSeconds) ? t.durationSeconds : 0,
    thumbnail: isString(t.thumbnail) && t.thumbnail.startsWith("https://") ? t.thumbnail : `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`,
  };
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isDate = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

/** Parse and sanitise a backup. Throws a readable error if it isn't one. */
export function parseBackup(text: string): BackupFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Playnest backup (it isn't valid JSON).");
  }
  if (!raw || raw.app !== "playnest") throw new Error("That file isn't a Playnest backup.");
  if (raw.version !== 1) throw new Error("This backup was made by a newer version of Playnest.");

  const playlists = asList(raw.playlists).flatMap((p) => {
    const pl = p as Record<string, unknown>;
    if (!pl || !isString(pl.name) || !pl.name.trim()) return [];
    const tracks = asList(pl.tracks).map(asTrack).filter((t): t is Track => t !== null);
    return [{ name: pl.name.trim().slice(0, 200), createdAt: isDate(pl.createdAt) ? pl.createdAt : new Date().toISOString(), tracks }];
  });

  const liked = asList(raw.liked).flatMap((e) => {
    const entry = e as Record<string, unknown>;
    const track = asTrack(entry?.track);
    return track ? [{ track, likedAt: isDate(entry.likedAt) ? entry.likedAt : new Date().toISOString() }] : [];
  });

  const plays = asList(raw.plays).flatMap((e) => {
    const entry = e as Record<string, unknown>;
    const track = asTrack(entry?.track);
    return track && isDate(entry.playedAt) ? [{ track, playedAt: entry.playedAt }] : [];
  });

  const searches = asList(raw.searches).flatMap((e) => {
    const entry = e as Record<string, unknown>;
    return entry && isString(entry.query) && isDate(entry.searchedAt)
      ? [{ query: entry.query.slice(0, 500), searchedAt: entry.searchedAt }]
      : [];
  });

  const savedSettings = raw.settings && typeof raw.settings === "object" ? (raw.settings as Partial<Settings>) : {};
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (typeof savedSettings.autoplay === "boolean") settings.autoplay = savedSettings.autoplay;
  if (typeof savedSettings.crossfadeSeconds === "number") settings.crossfadeSeconds = savedSettings.crossfadeSeconds;
  if (typeof savedSettings.songsOnly === "boolean") settings.songsOnly = savedSettings.songsOnly;
  if (typeof savedSettings.eqEnabled === "boolean") settings.eqEnabled = savedSettings.eqEnabled;
  if (isString(savedSettings.eqPreset)) settings.eqPreset = savedSettings.eqPreset;
  if (Array.isArray(savedSettings.eqGains) && savedSettings.eqGains.length === 10 && savedSettings.eqGains.every((g) => typeof g === "number")) {
    settings.eqGains = savedSettings.eqGains;
  }
  if (typeof savedSettings.levelling === "boolean") settings.levelling = savedSettings.levelling;
  if (typeof savedSettings.eqPreamp === "number" && Number.isFinite(savedSettings.eqPreamp)) {
    settings.eqPreamp = Math.max(-12, Math.min(12, savedSettings.eqPreamp));
  }
  if (savedSettings.layout === "classic" || savedSettings.layout === "modern") settings.layout = savedSettings.layout;
  if (savedSettings.skin === "y2k" || savedSettings.skin === "green" || savedSettings.skin === "black" || savedSettings.skin === "midnight") {
    settings.skin = savedSettings.skin;
  }

  const lyricsOffsets: Record<string, number> = {};
  if (raw.lyricsOffsets && typeof raw.lyricsOffsets === "object") {
    for (const [id, value] of Object.entries(raw.lyricsOffsets as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) lyricsOffsets[id] = value;
    }
  }

  return {
    app: "playnest",
    version: 1,
    exportedAt: isDate(raw.exportedAt) ? raw.exportedAt : new Date().toISOString(),
    playlists,
    liked,
    plays,
    searches,
    settings,
    lyricsOffsets,
  };
}

/** Merge a backup into the current library without duplicating anything:
 * a playlist with the same name gets the missing tracks added, likes and
 * plays already present are skipped, and settings come from the backup. */
export async function restoreBackup(backup: BackupFile): Promise<RestoreSummary> {
  const summary: RestoreSummary = {
    playlistsCreated: 0,
    playlistsMerged: 0,
    playlistTracksAdded: 0,
    likesAdded: 0,
    playsAdded: 0,
  };

  const existing = await fetchPlaylists();
  for (const playlist of backup.playlists) {
    const match = existing.find((p) => p.name === playlist.name);
    const id = match ? match.id : await createPlaylist(playlist.name);
    if (match) summary.playlistsMerged++;
    else summary.playlistsCreated++;
    summary.playlistTracksAdded += await addTracksToPlaylist(id, playlist.tracks);
  }

  summary.likesAdded = await restoreLikes(backup.liked);
  summary.playsAdded = await restorePlays(backup.plays);
  await restoreSearches(backup.searches);

  await saveSettings(backup.settings);
  const currentOffsets = (await loadAppState<Record<string, number>>("lyricsOffsets")) ?? {};
  await saveAppState("lyricsOffsets", { ...currentOffsets, ...backup.lyricsOffsets });

  return summary;
}

export function describeRestore(s: RestoreSummary): string {
  const parts: string[] = [];
  if (s.playlistsCreated) parts.push(`${s.playlistsCreated} new playlist${s.playlistsCreated === 1 ? "" : "s"}`);
  if (s.playlistsMerged) parts.push(`${s.playlistsMerged} existing playlist${s.playlistsMerged === 1 ? "" : "s"} topped up`);
  if (s.playlistTracksAdded) parts.push(`${s.playlistTracksAdded} playlist track${s.playlistTracksAdded === 1 ? "" : "s"}`);
  if (s.likesAdded) parts.push(`${s.likesAdded} liked song${s.likesAdded === 1 ? "" : "s"}`);
  if (s.playsAdded) parts.push(`${s.playsAdded.toLocaleString()} play${s.playsAdded === 1 ? "" : "s"} of history`);
  return parts.length
    ? `Restored ${parts.join(", ")}. Settings were restored too.`
    : "Nothing new to restore: your library already had everything in that backup. Settings were restored.";
}
