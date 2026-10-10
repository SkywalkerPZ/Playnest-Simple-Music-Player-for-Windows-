import { ReactNode, useState } from "react";
import { cleanTrack } from "../lib/titles";
import { compactNumber, DayCount, formatListeningTime, ListeningStats } from "../lib/stats";
import { Track } from "../lib/types";

interface StatsViewProps {
  stats: ListeningStats | null;
  isLoading: boolean;
  likedCount: number;
  currentTrackId: string | null;
  onPlay: (track: Track, list: Track[]) => void;
}

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-ink-800 border border-ink-700 rounded-xl px-4 py-3 min-w-0">
      <p className="text-xs text-mist-500">{label}</p>
      <p className="font-sans text-2xl font-semibold text-mist-100 mt-1 truncate">{value}</p>
      {note && <p className="text-[11px] text-mist-500 mt-0.5">{note}</p>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-ink-800 border border-ink-700 rounded-xl px-5 py-4 min-w-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-mist-100">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function formatDay(date: string, style: "short" | "long"): string {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(y, m - 1, d);
  return value.toLocaleDateString(undefined, style === "long"
    ? { weekday: "short", day: "numeric", month: "short" }
    : { day: "numeric", month: "short" });
}

/** Plays per day, one ember column per day. Single series, so no legend —
 * the panel title names it. Peak is labeled; every column shows its exact
 * value on hover, and a table view carries the full numbers. */
function ActivityChart({ days }: { days: DayCount[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.plays));
  const peakIndex = days.findIndex((d) => d.plays === max && max > 0);

  return (
    <div className="relative">
      <div className="flex items-end h-40 pt-5 border-b border-ink-600" role="img" aria-label="Plays per day over the last 30 days">
        {days.map((day, i) => {
          const heightPct = (day.plays / max) * 100;
          return (
            <div
              key={day.date}
              className="relative flex-1 h-full flex items-end justify-center px-px"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
            >
              {day.plays > 0 && (
                <div
                  className={`w-full max-w-[24px] rounded-t-[4px] transition-opacity ${
                    hovered === null || hovered === i ? "bg-ember" : "bg-ember opacity-40"
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
              )}
              {i === peakIndex && hovered === null && (
                <span className="absolute text-[11px] text-mist-300" style={{ bottom: `calc(${heightPct}% + 4px)` }}>
                  {day.plays}
                </span>
              )}
              {hovered === i && (
                <div
                  className="absolute z-10 pointer-events-none whitespace-nowrap bg-ink-950 border border-ink-600 rounded-md px-2 py-1 text-[11px] text-mist-100 shadow-lg"
                  style={{ bottom: `calc(${Math.max(heightPct, 0)}% + 8px)` }}
                >
                  <span className="text-mist-500">{formatDay(day.date, "long")}</span>
                  <span className="ml-1.5 font-medium">
                    {day.plays} play{day.plays === 1 ? "" : "s"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-mist-500">
        <span>{formatDay(days[0].date, "short")}</span>
        <span>{formatDay(days[14].date, "short")}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function ActivityTable({ days }: { days: DayCount[] }) {
  return (
    <div className="max-h-44 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-mist-500">
            <th className="font-normal pb-1">Day</th>
            <th className="font-normal pb-1 text-right">Plays</th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((d) => (
            <tr key={d.date} className="border-t border-ink-700">
              <td className="py-1 text-mist-300">{formatDay(d.date, "long")}</td>
              <td className="py-1 text-right tabular-nums text-mist-100">{d.plays}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StatsView({ stats, isLoading, likedCount, currentTrackId, onPlay }: StatsViewProps) {
  const [showTable, setShowTable] = useState(false);

  if (isLoading && !stats) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <h1 className="font-display text-xl font-semibold mb-6">Stats</h1>
        <p className="text-sm text-mist-500">Crunching your listening history…</p>
      </div>
    );
  }

  if (!stats || stats.totalPlays === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <h1 className="font-display text-xl font-semibold mb-6">Stats</h1>
        <p className="text-sm text-mist-500">Play some music and your stats will show up here.</p>
      </div>
    );
  }

  const topArtistMax = Math.max(1, ...stats.topArtists.map((a) => a.plays));
  const topTrackList = stats.topTracks.map((t) => t.track);
  const since = stats.firstPlayedAt
    ? new Date(stats.firstPlayedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <h1 className="font-display text-xl font-semibold">Stats</h1>
      <p className="text-sm text-mist-500 mt-1 mb-6">
        {since ? `Your listening since ${since}.` : "Your listening so far."}
      </p>

      <div className="max-w-4xl flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Plays" value={compactNumber(stats.totalPlays)} />
          <StatTile
            label="Listening time"
            value={formatListeningTime(stats.approxSeconds)}
            note="Estimated from track lengths"
          />
          <StatTile label="Artists" value={compactNumber(stats.uniqueArtists)} />
          <StatTile label="Liked songs" value={compactNumber(likedCount)} />
        </div>

        <Panel
          title="Plays per day, last 30 days"
          action={
            <button
              onClick={() => setShowTable((v) => !v)}
              className="text-xs text-mist-500 hover:text-mist-100"
            >
              {showTable ? "Show chart" : "Show as table"}
            </button>
          }
        >
          {showTable ? <ActivityTable days={stats.last30Days} /> : <ActivityChart days={stats.last30Days} />}
        </Panel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Top artists">
            <ol className="flex flex-col gap-1">
              {stats.topArtists.map((artist) => (
                <li
                  key={artist.name}
                  className="grid grid-cols-[8rem_1fr] items-center gap-3 rounded-md px-1 py-1 hover:bg-ink-700/50"
                  title={`${artist.name}: ${artist.plays} play${artist.plays === 1 ? "" : "s"}`}
                >
                  <span className="text-sm text-mist-100 truncate">{artist.name}</span>
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2 bg-ember rounded-r-[4px] shrink-0"
                      style={{ width: `max(2px, calc((100% - 3rem) * ${artist.plays / topArtistMax}))` }}
                    />
                    <span className="text-xs text-mist-500 tabular-nums">{artist.plays}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Top tracks">
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Rank</th>
                  <th>Track</th>
                  <th>Plays</th>
                </tr>
              </thead>
              <tbody>
                {stats.topTracks.map(({ track, plays }, i) => {
                  const clean = cleanTrack(track);
                  const isCurrent = track.id === currentTrackId;
                  return (
                    <tr
                      key={track.id}
                      onClick={() => onPlay(track, topTrackList)}
                      className="cursor-pointer hover:bg-ink-700/50"
                      title="Play"
                    >
                      <td className="py-1.5 pl-1 pr-3 w-6 text-mist-500 tabular-nums align-top">{i + 1}</td>
                      <td className="py-1.5 pr-3 min-w-0">
                        <p className={`truncate max-w-[16rem] ${isCurrent ? "text-ember" : "text-mist-100"}`}>
                          {clean.title}
                        </p>
                        <p className="text-xs text-mist-500 truncate max-w-[16rem]">{clean.artist}</p>
                      </td>
                      <td className="py-1.5 pr-1 text-right text-xs text-mist-500 tabular-nums align-top">
                        {plays}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}
