import { CSSProperties, FormEvent, useRef, useState } from "react";
import { Track } from "../lib/types";
import { useTrackActions } from "./TrackActions";

export interface ExtraAction {
  label: string;
  onClick: () => void;
}

interface TrackMenuProps {
  track: Track;
  hideAddToQueue?: boolean;
  extraActions?: ExtraAction[];
}

const MENU_HEIGHT_ESTIMATE = 320;

/** The "⋯" menu on every track row. Positioned with `fixed` so it can't be
 * clipped by a scrolling list, and flips upward near the bottom of the
 * window. */
export default function TrackMenu({ track, hideAddToQueue, extraActions = [] }: TrackMenuProps) {
  const actions = useTrackActions();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [newName, setNewName] = useState("");

  const isDownloaded = actions.downloadedIds.has(track.id);
  const isDownloading = actions.downloadingIds.has(track.id);

  function open() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = window.innerWidth - rect.right;
    const fitsBelow = rect.bottom + MENU_HEIGHT_ESTIMATE < window.innerHeight;
    setPosition(
      fitsBelow
        ? { top: rect.bottom + 4, right }
        : { bottom: window.innerHeight - rect.top + 4, right }
    );
  }

  function close() {
    setPosition(null);
    setNewName("");
  }

  function run(fn: () => void) {
    fn();
    close();
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    run(() => actions.createPlaylistWith(name, track));
  }

  const itemClass =
    "w-full text-left px-3 py-1.5 text-sm text-mist-100 hover:bg-ink-700 truncate disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => (position ? close() : open())}
        aria-label={`More options for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        className="w-7 h-7 flex items-center justify-center rounded-full text-mist-500 hover:text-mist-100 hover:bg-ink-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>

      {position && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={close}
          />
          <div
            role="menu"
            style={position}
            className="fixed z-50 w-60 bg-ink-800 border border-ink-700 rounded-lg shadow-xl py-2"
          >
            <button className={itemClass} onClick={() => run(() => actions.playNext(track))}>
              Play next
            </button>
            {!hideAddToQueue && (
              <button className={itemClass} onClick={() => run(() => actions.addToQueue(track))}>
                Add to queue
              </button>
            )}
            {isDownloaded ? (
              <button className={itemClass} onClick={() => run(() => actions.removeDownload(track))}>
                Remove download
              </button>
            ) : (
              <button
                className={itemClass}
                disabled={isDownloading}
                onClick={() => run(() => actions.download(track))}
              >
                {isDownloading ? "Downloading…" : "Download for offline"}
              </button>
            )}
            {extraActions.map((action) => (
              <button key={action.label} className={itemClass} onClick={() => run(action.onClick)}>
                {action.label}
              </button>
            ))}

            <div className="h-px bg-ink-700 my-1.5" />
            <p className="px-3 pb-1 text-xs font-medium text-mist-500 uppercase tracking-wide">
              Add to playlist
            </p>
            {actions.playlists.length > 0 && (
              <div className="max-h-36 overflow-y-auto">
                {actions.playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    className={itemClass}
                    onClick={() => run(() => actions.addToPlaylist(playlist.id, track))}
                  >
                    {playlist.name}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={handleCreate} className="px-3 pt-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New playlist name"
                aria-label="New playlist name"
                className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-mist-100 placeholder:text-mist-500 focus:border-ember"
              />
            </form>
          </div>
        </>
      )}
    </>
  );
}
