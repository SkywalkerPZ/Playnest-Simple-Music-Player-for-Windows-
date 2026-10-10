import { FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { cleanTrack } from "../lib/titles";
import { formatDuration } from "../lib/format";
import { Track } from "../lib/types";
import { useDragReorder } from "../lib/useDragReorder";
import { PopupMenu, TitleBar } from "./parts";
import { ClassicPlayer } from "./types";

interface PlaylistWindowProps {
  player: ClassicPlayer;
  onClose: () => void;
  /** Open the library on Search. */
  onFindMusic: () => void;
}

type MenuKey = "add" | "rem" | "sel" | "misc" | null;

function longDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const rowText = (track: Track) => {
  const c = cleanTrack(track);
  return c.artist ? `${c.artist} - ${c.title}` : c.title;
};

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The playing track followed by the queue, as one numbered list. The
 * playing track (row 1) can't be removed or moved; everything else can. */
export default function PlaylistWindow({ player, onClose, onFindMusic }: PlaylistWindowProps) {
  const { track: current, queue } = player;
  const [selected, setSelected] = useState<Set<number>>(new Set()); // queue indexes
  const [anchor, setAnchor] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuKey>(null);
  const [saving, setSaving] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { rowProps, indicatorFor } = useDragReorder(queue, (next) => {
    player.onQueueChange(next);
    setSelected(new Set());
  });

  // Indexes go stale when the queue changes underneath the selection.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((i) => i < queue.length));
      return next.size === prev.size ? prev : next;
    });
  }, [queue.length]);

  const totalSeconds = useMemo(
    () => queue.reduce((sum, t) => sum + t.durationSeconds, current?.durationSeconds ?? 0),
    [queue, current]
  );
  const selectedSeconds = [...selected].reduce((sum, i) => sum + (queue[i]?.durationSeconds ?? 0), 0);
  const count = queue.length + (current ? 1 : 0);
  const offset = current ? 1 : 0; // queue index i is shown as row i + offset + 1

  function selectRow(index: number, e: MouseEvent | KeyboardEvent) {
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      setAnchor(index);
    } else {
      setSelected(new Set([index]));
      setAnchor(index);
    }
  }

  function removeSelected() {
    if (selected.size === 0) return;
    player.onQueueChange(queue.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  }

  function crop() {
    if (selected.size === 0) return;
    player.onQueueChange(queue.filter((_, i) => selected.has(i)));
    setSelected(new Set());
  }

  function addTracks(tracks: Track[]) {
    const have = new Set(queue.map((t) => t.id));
    if (current) have.add(current.id);
    player.onQueueChange([...queue, ...tracks.filter((t) => !have.has(t.id))]);
  }

  function reorder(next: Track[]) {
    player.onQueueChange(next);
    setSelected(new Set());
  }

  function run(action: () => void) {
    action();
    setMenu(null);
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (queue.length === 0) return;
    const focusIndex = anchor ?? -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation(); // not volume
      const next = Math.max(0, Math.min(queue.length - 1, focusIndex + (e.key === "ArrowDown" ? 1 : -1)));
      selectRow(next, e);
      if (!e.shiftKey) setAnchor(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    } else if (e.key === "Enter" && focusIndex >= 0 && queue[focusIndex]) {
      e.preventDefault();
      player.onPlayFromQueue(queue[focusIndex]);
    } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected(new Set(queue.map((_, i) => i)));
    }
  }

  async function saveAsPlaylist(e: FormEvent) {
    e.preventDefault();
    const name = playlistName.trim();
    if (!name) return;
    await player.onSaveQueueAsPlaylist(name);
    setSaving(false);
    setPlaylistName("");
  }

  const toggleMenu = (key: MenuKey) => setMenu((m) => (m === key ? null : key));

  return (
    <section className="cw-window flex-1 min-h-[120px]" aria-label="Playlist">
      <TitleBar title="PLAYNEST PLAYLIST" onClose={onClose} closeLabel="Hide playlist" />

      <div
        ref={listRef}
        className="cw-list flex-1 min-h-0"
        role="listbox"
        aria-label="Now playing and up next"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={onListKeyDown}
      >
        {count === 0 && (
          <p className="px-[6px] py-[5px] leading-[1.5]" style={{ color: "var(--cw-list-dim)" }}>
            The playlist is empty. Press ADD, or search the library and use “Play next” or “Add to queue” on any song.
          </p>
        )}

        {current && (
          <div
            className="cw-list-row"
            role="option"
            aria-selected={false}
            data-current="true"
            onDoubleClick={() => (player.isPlaying ? player.onSeek(0) : player.onPlay())}
            title="Now playing"
          >
            <span className="truncate">1. {rowText(current)}</span>
            <span className="cw-list-time">{formatDuration(current.durationSeconds)}</span>
          </div>
        )}

        {queue.map((track, i) => (
          <div
            key={`${track.id}-${i}`}
            className="cw-list-row"
            role="option"
            data-index={i}
            aria-selected={selected.has(i)}
            data-drop={indicatorFor(i) ?? undefined}
            onClick={(e) => selectRow(i, e)}
            onDoubleClick={() => player.onPlayFromQueue(track)}
            {...rowProps(i)}
          >
            <span className="truncate">
              {i + offset + 1}. {rowText(track)}
            </span>
            <span className="cw-list-time">{formatDuration(track.durationSeconds)}</span>
          </div>
        ))}
      </div>

      {saving ? (
        <form onSubmit={saveAsPlaylist} className="flex items-center gap-[4px] mt-[5px]">
          <span className="cw-label">NAME</span>
          <input
            autoFocus
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSaving(false)}
            placeholder="New playlist name"
            aria-label="Playlist name"
            className="cw-lcd flex-1 min-w-0 h-[18px] px-[4px] text-[15px] outline-none"
            style={{ color: "var(--cw-lcd-text)" }}
            maxLength={200}
          />
          <button type="submit" className="cw-btn" disabled={!playlistName.trim()}>
            SAVE
          </button>
          <button type="button" className="cw-btn" onClick={() => setSaving(false)}>
            CANCEL
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-[3px] mt-[5px]">
          <div className="relative">
            <button className="cw-btn" onClick={() => toggleMenu("add")} aria-haspopup="menu" aria-expanded={menu === "add"}>
              ADD
            </button>
            <PopupMenu open={menu === "add"} onClose={() => setMenu(null)} label="Add" className="left-0 bottom-[20px]">
              <button role="menuitem" onClick={() => run(onFindMusic)}>
                Search for music…
              </button>
              <button role="menuitem" disabled={player.likedTracks.length === 0} onClick={() => run(() => addTracks(player.likedTracks))}>
                All Liked Songs
              </button>
              <button
                role="menuitem"
                disabled={player.downloadedTracks.length === 0}
                onClick={() => run(() => addTracks(player.downloadedTracks))}
              >
                All Downloads
              </button>
              <hr />
              <button role="menuitem" onClick={() => run(player.onImportPlaylist)}>
                Import a YouTube playlist…
              </button>
            </PopupMenu>
          </div>

          <div className="relative">
            <button className="cw-btn" onClick={() => toggleMenu("rem")} aria-haspopup="menu" aria-expanded={menu === "rem"}>
              REM
            </button>
            <PopupMenu open={menu === "rem"} onClose={() => setMenu(null)} label="Remove" className="left-0 bottom-[20px]">
              <button role="menuitem" disabled={selected.size === 0} onClick={() => run(removeSelected)}>
                Remove selected (Del)
              </button>
              <button role="menuitem" disabled={selected.size === 0} onClick={() => run(crop)}>
                Keep only selected
              </button>
              <hr />
              <button role="menuitem" disabled={queue.length === 0} onClick={() => run(() => reorder([]))}>
                Clear up next
              </button>
            </PopupMenu>
          </div>

          <div className="relative">
            <button className="cw-btn" onClick={() => toggleMenu("sel")} aria-haspopup="menu" aria-expanded={menu === "sel"}>
              SEL
            </button>
            <PopupMenu open={menu === "sel"} onClose={() => setMenu(null)} label="Select" className="left-0 bottom-[20px]">
              <button role="menuitem" onClick={() => run(() => setSelected(new Set(queue.map((_, i) => i))))}>
                Select all
              </button>
              <button role="menuitem" onClick={() => run(() => setSelected(new Set()))}>
                Select none
              </button>
              <button
                role="menuitem"
                onClick={() => run(() => setSelected(new Set(queue.map((_, i) => i).filter((i) => !selected.has(i)))))}
              >
                Invert selection
              </button>
            </PopupMenu>
          </div>

          <div className="relative">
            <button className="cw-btn" onClick={() => toggleMenu("misc")} aria-haspopup="menu" aria-expanded={menu === "misc"}>
              MISC
            </button>
            <PopupMenu open={menu === "misc"} onClose={() => setMenu(null)} label="Misc" className="left-0 bottom-[20px]">
              <button role="menuitem" disabled={queue.length < 2} onClick={() => run(() => reorder(shuffled(queue)))}>
                Shuffle up next
              </button>
              <button
                role="menuitem"
                disabled={queue.length < 2}
                onClick={() => run(() => reorder([...queue].sort((a, b) => rowText(a).localeCompare(rowText(b)))))}
              >
                Sort by artist
              </button>
              <button
                role="menuitem"
                disabled={queue.length < 2}
                onClick={() =>
                  run(() => reorder([...queue].sort((a, b) => cleanTrack(a).title.localeCompare(cleanTrack(b).title))))
                }
              >
                Sort by title
              </button>
              <button role="menuitem" disabled={queue.length < 2} onClick={() => run(() => reorder([...queue].reverse()))}>
                Reverse
              </button>
              <hr />
              <button role="menuitem" disabled={count === 0} onClick={() => run(() => setSaving(true))}>
                Save as playlist…
              </button>
            </PopupMenu>
          </div>

          <div
            className="cw-lcd ml-auto h-[18px] px-[5px] flex items-center cw-lcd-text text-[15px] tabular-nums whitespace-nowrap"
            title={`${count} tracks`}
            aria-label={`${count} tracks, ${longDuration(totalSeconds)} total`}
          >
            {selected.size > 0 ? `${longDuration(selectedSeconds)}/` : ""}
            {longDuration(totalSeconds)} · {count}
          </div>
        </div>
      )}
    </section>
  );
}
