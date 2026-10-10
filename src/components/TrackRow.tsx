import { Track } from "../lib/types";
import { formatDuration } from "../lib/format";
import { cleanTrack } from "../lib/titles";
import { DragRowProps, DropIndicator } from "../lib/useDragReorder";
import { useTrackActions } from "./TrackActions";
import TrackMenu, { ExtraAction } from "./TrackMenu";

interface TrackRowProps {
  track: Track;
  isCurrent: boolean;
  isPlaying?: boolean;
  onPlay: () => void;
  /** Shown instead of the artist (e.g. a suggestion's reason). */
  subtitle?: string;
  hideAddToQueue?: boolean;
  extraActions?: ExtraAction[];
  drag?: DragRowProps;
  dropIndicator?: DropIndicator;
  isDragging?: boolean;
}

export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 13.7 2.6 8.6a3.3 3.3 0 0 1 4.7-4.7L8 4.6l.7-.7a3.3 3.3 0 0 1 4.7 4.7Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TrackRow({
  track,
  isCurrent,
  isPlaying,
  onPlay,
  subtitle,
  hideAddToQueue,
  extraActions,
  drag,
  dropIndicator,
  isDragging,
}: TrackRowProps) {
  const actions = useTrackActions();
  const clean = cleanTrack(track);
  const liked = actions.likedIds.has(track.id);
  const downloaded = actions.downloadedIds.has(track.id);
  const downloading = actions.downloadingIds.has(track.id);

  return (
    <li
      {...drag}
      className={`relative flex items-center gap-3 py-3 group ${isDragging ? "opacity-40" : ""} ${
        drag ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {dropIndicator && (
        <span
          aria-hidden="true"
          className={`absolute left-0 right-0 h-0.5 bg-ember rounded ${
            dropIndicator === "above" ? "-top-px" : "-bottom-px"
          }`}
        />
      )}

      {drag && (
        <span aria-hidden="true" className="text-mist-500 opacity-0 group-hover:opacity-60 -ml-1">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="3" r="1.2" />
            <circle cx="7" cy="3" r="1.2" />
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="3" cy="11" r="1.2" />
            <circle cx="7" cy="11" r="1.2" />
          </svg>
        </span>
      )}

      <img
        src={track.thumbnail}
        alt=""
        draggable={false}
        className="w-12 h-12 rounded-md object-cover bg-ink-700 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium truncate ${isCurrent ? "text-ember" : "text-mist-100"}`}
          title={track.title}
        >
          {clean.title}
        </p>
        <p className="text-xs text-mist-500 truncate flex items-center gap-1.5">
          {downloaded && (
            <span className="text-ember shrink-0" title="Available offline">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-label="Downloaded">
                <path d="M8 2v9m0 0-3.5-3.5M8 11l3.5-3.5M3 14h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          {downloading && <span className="shrink-0">Downloading…</span>}
          {subtitle !== undefined ? (
            <span className="truncate">{subtitle}</span>
          ) : (
            <button
              onClick={() => actions.openArtist(clean.artist)}
              draggable={false}
              className="truncate hover:text-mist-100 hover:underline underline-offset-2"
              title={`Go to ${clean.artist}`}
            >
              {clean.artist}
            </button>
          )}
        </p>
      </div>

      <button
        onClick={() => actions.toggleLike(track)}
        aria-label={liked ? `Unlike ${clean.title}` : `Like ${clean.title}`}
        aria-pressed={liked}
        className={`w-7 h-7 flex items-center justify-center rounded-full transition-opacity ${
          liked
            ? "text-ember"
            : "text-mist-500 hover:text-mist-100 opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <HeartIcon filled={liked} />
      </button>

      <span className="text-xs text-mist-500 tabular-nums w-10 text-right">
        {formatDuration(track.durationSeconds)}
      </span>

      <TrackMenu track={track} hideAddToQueue={hideAddToQueue} extraActions={extraActions} />

      <button
        onClick={onPlay}
        className="text-xs font-medium px-3 py-1.5 rounded-full bg-ember/10 text-ember hover:bg-ember hover:text-ink-950 transition-colors"
      >
        {isCurrent && isPlaying ? "Playing" : "Play"}
      </button>
    </li>
  );
}
