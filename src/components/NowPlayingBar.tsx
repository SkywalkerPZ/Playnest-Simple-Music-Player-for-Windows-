import { Track } from "../lib/types";
import { formatDuration } from "../lib/format";
import { cleanTrack } from "../lib/titles";
import { HeartIcon } from "./TrackRow";
import SleepTimerMenu, { SleepTimer } from "./SleepTimerMenu";

type RepeatMode = "off" | "all" | "one";

interface NowPlayingBarProps {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  isLoading: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  lyricsOpen: boolean;
  liked: boolean;
  sleepTimer: SleepTimer;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onSkipNext: () => void;
  onSkipPrevious: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLyrics: () => void;
  onToggleLike: () => void;
  onSetSleepTimer: (timer: SleepTimer) => void;
  onOpenArtist: (name: string) => void;
}

export default function NowPlayingBar({
  track,
  isPlaying,
  currentTime,
  volume,
  isLoading,
  shuffle,
  repeatMode,
  lyricsOpen,
  liked,
  sleepTimer,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onSkipNext,
  onSkipPrevious,
  onToggleShuffle,
  onCycleRepeat,
  onToggleLyrics,
  onToggleLike,
  onSetSleepTimer,
  onOpenArtist,
}: NowPlayingBarProps) {
  const duration = track?.durationSeconds ?? 0;
  const clean = track ? cleanTrack(track) : null;

  return (
    <footer className="h-20 shrink-0 bg-ink-950 border-t border-ink-700 flex items-center px-5 gap-5">
      <div className="w-64 flex items-center gap-3 min-w-0">
        {track && clean ? (
          <>
            <img src={track.thumbnail} alt="" className="w-12 h-12 rounded-md object-cover bg-ink-700 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" title={track.title}>
                {clean.title}
              </p>
              <button
                onClick={() => onOpenArtist(clean.artist)}
                title={`Go to ${clean.artist}`}
                className="block max-w-full text-left text-xs text-mist-500 truncate hover:text-mist-100 hover:underline underline-offset-2"
              >
                {clean.artist}
              </button>
            </div>
            <button
              onClick={onToggleLike}
              aria-label={liked ? "Unlike current track" : "Like current track"}
              aria-pressed={liked}
              className={`shrink-0 ${liked ? "text-ember" : "text-mist-500 hover:text-mist-100"}`}
            >
              <HeartIcon filled={liked} />
            </button>
          </>
        ) : (
          <p className="text-sm text-mist-500">Nothing playing</p>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-4">
          <button
            onClick={onToggleShuffle}
            aria-label="Toggle shuffle"
            aria-pressed={shuffle}
            className={shuffle ? "text-ember" : "text-mist-500 hover:text-mist-100"}
            title="Shuffle"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M1 3h2.5L11 13h4M1 13h2.5L7 8M12 3h3l-2 2M12 3l-2-2M15 11l-2 2 2 2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            onClick={onSkipPrevious}
            disabled={!track}
            aria-label="Previous track"
            title="Previous (restarts the track if it's past 3 seconds)"
            className="text-mist-500 hover:text-mist-100 disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="2" y="2" width="2" height="12" rx="0.5" />
              <path d="M14 2.6v10.8a0.8 0.8 0 0 1-1.24.66l-8-5.4a0.8 0.8 0 0 1 0-1.32l8-5.4A0.8 0.8 0 0 1 14 2.6Z" />
            </svg>
          </button>

          <button
            onClick={onTogglePlay}
            disabled={!track}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="w-9 h-9 rounded-full bg-ember flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="w-3 h-3 rounded-full border-2 border-ink-950 border-t-transparent animate-spin" />
            ) : isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="#0e1016" aria-hidden="true">
                <rect x="1" y="0" width="4" height="12" rx="1" />
                <rect x="7" y="0" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="#0e1016" aria-hidden="true">
                <path d="M1 0.7v10.6a0.7 0.7 0 0 0 1.06.6l8.6-5.3a0.7 0.7 0 0 0 0-1.2L2.06 0.1A0.7 0.7 0 0 0 1 0.7Z" />
              </svg>
            )}
          </button>

          <button onClick={onSkipNext} aria-label="Next track" className="text-mist-500 hover:text-mist-100">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="12" y="2" width="2" height="12" rx="0.5" />
              <path d="M2 2.6v10.8a0.8 0.8 0 0 0 1.24.66l8-5.4a0.8 0.8 0 0 0 0-1.32l-8-5.4A0.8 0.8 0 0 0 2 2.6Z" />
            </svg>
          </button>

          <button
            onClick={onCycleRepeat}
            aria-label={`Repeat: ${repeatMode}`}
            className={`relative ${repeatMode !== "off" ? "text-ember" : "text-mist-500 hover:text-mist-100"}`}
            title={`Repeat: ${repeatMode}`}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 6V5a3 3 0 0 1 3-3h7l-2-2m2 2-2 2M14 10v1a3 3 0 0 1-3 3H4l2 2m-2-2 2-2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {repeatMode === "one" && (
              <span className="absolute -top-1 -right-1 text-[9px] leading-none">1</span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="text-xs text-mist-500 tabular-nums w-9 text-right">{formatDuration(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(currentTime, duration)}
            onChange={(e) => onSeek(Number(e.target.value))}
            disabled={!track}
            aria-label="Seek"
            className="flex-1 accent-ember h-1"
          />
          <span className="text-xs text-mist-500 tabular-nums w-9">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="w-64 flex items-center gap-3 justify-end">
        <SleepTimerMenu timer={sleepTimer} onSet={onSetSleepTimer} />
        <button
          onClick={onToggleLyrics}
          aria-label="Toggle lyrics"
          aria-pressed={lyricsOpen}
          className={`text-xs font-medium px-2 py-1 rounded ${
            lyricsOpen ? "text-ember bg-ember/10" : "text-mist-500 hover:text-mist-100"
          }`}
        >
          Lyrics
        </button>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-mist-500 shrink-0" aria-hidden="true">
          <path d="M2 6v4h2.5l3.5 3V3l-3.5 3H2Z" fill="currentColor" />
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="w-20 accent-ember h-1"
          aria-label="Volume"
        />
      </div>
    </footer>
  );
}
