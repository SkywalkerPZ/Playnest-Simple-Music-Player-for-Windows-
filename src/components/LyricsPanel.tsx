import { useEffect, useRef } from "react";
import { Lyrics } from "../lib/lyrics";
import { formatDuration } from "../lib/format";

interface LyricsPanelProps {
  lyrics: Lyrics | null;
  isLoading: boolean;
  currentTime: number;
  trackTitle: string | null;
  trackDuration: number;
  /** Seconds added to playback time when matching lines. Positive shows
   * lyrics earlier, negative later. Saved per track. */
  offset: number;
  onOffsetChange: (offset: number) => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

const NUDGE_STEP = 0.5;
/** Past this difference the lyrics were almost certainly timed to another
 * cut (album version vs. music video with an intro, radio edit, etc). */
const LENGTH_MISMATCH_SECONDS = 4;

function formatOffset(offset: number): string {
  if (offset === 0) return "0s";
  return `${offset > 0 ? "+" : "−"}${Math.abs(offset).toFixed(1)}s`;
}

export default function LyricsPanel({
  lyrics,
  isLoading,
  currentTime,
  trackTitle,
  trackDuration,
  offset,
  onOffsetChange,
  onSeek,
  onClose,
}: LyricsPanelProps) {
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const lyricTime = currentTime + offset;

  const activeIndex =
    lyrics?.synced?.reduce((best, line, i) => (line.time <= lyricTime ? i : best), -1) ?? -1;

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  const hasSynced = !!lyrics?.synced && lyrics.synced.length > 0;
  const lengthGap =
    hasSynced && lyrics?.sourceDuration && trackDuration > 0
      ? trackDuration - lyrics.sourceDuration
      : 0;
  const lengthMismatch = Math.abs(lengthGap) > LENGTH_MISMATCH_SECONDS;
  // A video longer than the album cut usually means an intro before the
  // song starts, so the lyrics need to come later by about that much.
  const suggestedOffset = lengthGap > 0 ? -Math.round(lengthGap * 2) / 2 : null;

  return (
    <aside className="w-80 shrink-0 bg-ink-950 border-l border-ink-700 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
        <h2 className="font-display text-sm font-semibold truncate">Lyrics</h2>
        <button onClick={onClose} aria-label="Close lyrics" className="text-mist-500 hover:text-mist-100">
          ✕
        </button>
      </div>

      {hasSynced && (
        <div className="px-5 py-3 border-b border-ink-700">
          <div className="flex items-center gap-2">
            <span className="text-xs text-mist-500 mr-auto">
              Timing <span className="tabular-nums text-mist-300">{formatOffset(offset)}</span>
            </span>
            <button
              onClick={() => onOffsetChange(+(offset - NUDGE_STEP).toFixed(1))}
              title="Lyrics are running ahead of the song"
              className="text-xs px-2 py-1 rounded-full border border-ink-600 text-mist-300 hover:border-mist-500"
            >
              Later
            </button>
            <button
              onClick={() => onOffsetChange(+(offset + NUDGE_STEP).toFixed(1))}
              title="Lyrics are lagging behind the song"
              className="text-xs px-2 py-1 rounded-full border border-ink-600 text-mist-300 hover:border-mist-500"
            >
              Earlier
            </button>
            {offset !== 0 && (
              <button
                onClick={() => onOffsetChange(0)}
                className="text-xs px-1.5 py-1 text-mist-500 hover:text-mist-100"
              >
                Reset
              </button>
            )}
          </div>
          {lengthMismatch && lyrics?.sourceDuration && (
            <p className="text-[11px] text-mist-500 mt-2 leading-relaxed">
              These lyrics are timed to a {formatDuration(lyrics.sourceDuration)} version, but this
              upload is {formatDuration(trackDuration)}, so they may drift.
              {suggestedOffset !== null && offset !== suggestedOffset && (
                <>
                  {" "}
                  <button
                    onClick={() => onOffsetChange(suggestedOffset)}
                    className="text-ember-soft hover:text-ember underline underline-offset-2"
                  >
                    Shift {formatOffset(suggestedOffset)} for a video intro
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <p className="text-sm text-mist-500">Looking for lyrics…</p>
        ) : !trackTitle ? (
          <p className="text-sm text-mist-500">Nothing playing.</p>
        ) : hasSynced && lyrics?.synced ? (
          <div className="flex flex-col gap-1">
            {lyrics.synced.map((line, i) => (
              <button
                key={i}
                ref={i === activeIndex ? activeLineRef : undefined}
                onClick={() => onSeek(Math.max(0, line.time - offset))}
                title="Jump here"
                className={`text-left text-sm leading-relaxed rounded px-1 -mx-1 py-1 transition-colors hover:bg-ink-800 ${
                  i === activeIndex ? "text-ember font-medium" : "text-mist-500"
                }`}
              >
                {line.text}
              </button>
            ))}
          </div>
        ) : lyrics?.plain ? (
          <>
            <p className="text-[11px] text-mist-500 mb-3">
              Only unsynced lyrics were found for this track.
            </p>
            <p className="text-sm text-mist-300 leading-relaxed whitespace-pre-line">{lyrics.plain}</p>
          </>
        ) : (
          <p className="text-sm text-mist-500">No lyrics found for this track.</p>
        )}
      </div>
    </aside>
  );
}
