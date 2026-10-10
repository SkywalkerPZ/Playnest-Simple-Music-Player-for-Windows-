import { PlayLogEntry } from "./db";
import { artistKey, cleanTrack } from "./titles";
import { Track } from "./types";

export interface RankedArtist {
  name: string;
  plays: number;
}

export interface RankedTrack {
  track: Track;
  plays: number;
}

export interface DayCount {
  /** Local date, YYYY-MM-DD. */
  date: string;
  plays: number;
}

export interface ListeningStats {
  totalPlays: number;
  /** Sum of track lengths across plays. Playnest doesn't record how much of
   * each track was heard, so this is an upper-bound estimate. */
  approxSeconds: number;
  uniqueArtists: number;
  uniqueTracks: number;
  topArtists: RankedArtist[];
  topTracks: RankedTrack[];
  last30Days: DayCount[];
  firstPlayedAt: string | null;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeStats(log: PlayLogEntry[], now = new Date()): ListeningStats {
  const artists = new Map<string, RankedArtist>();
  const tracks = new Map<string, RankedTrack>();
  const byDay = new Map<string, number>();
  let approxSeconds = 0;

  for (const { track, playedAt } of log) {
    approxSeconds += track.durationSeconds || 0;

    const name = cleanTrack(track).artist;
    const key = artistKey(name);
    const a = artists.get(key) ?? { name, plays: 0 };
    a.plays++;
    artists.set(key, a);

    const t = tracks.get(track.id) ?? { track, plays: 0 };
    t.plays++;
    tracks.set(track.id, t);

    const day = localDateKey(new Date(playedAt));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const last30Days: DayCount[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const date = localDateKey(d);
    last30Days.push({ date, plays: byDay.get(date) ?? 0 });
  }

  return {
    totalPlays: log.length,
    approxSeconds,
    uniqueArtists: artists.size,
    uniqueTracks: tracks.size,
    topArtists: [...artists.values()].sort((a, b) => b.plays - a.plays).slice(0, 8),
    topTracks: [...tracks.values()].sort((a, b) => b.plays - a.plays).slice(0, 10),
    last30Days,
    firstPlayedAt: log.length > 0 ? log[log.length - 1].playedAt : null,
  };
}

/** 1,284 / 12.9K / 1.2M */
export function compactNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "14h 20m" / "35m" */
export function formatListeningTime(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (hours >= 100) return `${compactNumber(hours)}h`;
  return `${hours}h ${minutes}m`;
}
