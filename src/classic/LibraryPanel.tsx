import { FormEvent, ReactNode, useState } from "react";
import { NavKey, View } from "../components/Sidebar";
import { Playlist } from "../lib/types";
import { TitleBar } from "./parts";

interface LibraryPanelProps {
  view: View;
  onViewChange: (view: NavKey) => void;
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  onSelectPlaylist: (id: number) => void;
  onCreatePlaylist: (name: string) => void;
  onImportPlaylist: () => void;
  onClose: () => void;
  /** The page for the current view (search, liked, a playlist…). */
  children: ReactNode;
  /** Lyrics, shown beside the page when open. */
  side?: ReactNode;
}

// The queue lives in the playlist window and sound in the EQ window, so
// neither needs a page here.
const NAV: { key: NavKey; label: string }[] = [
  { key: "search", label: "Search" },
  { key: "suggestions", label: "Suggestions" },
  { key: "liked", label: "Liked Songs" },
  { key: "downloads", label: "Downloads" },
  { key: "recent", label: "Recently Played" },
  { key: "stats", label: "Stats" },
  { key: "settings", label: "Settings" },
];

export default function LibraryPanel({
  view,
  onViewChange,
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onImportPlaylist,
  onClose,
  children,
  side,
}: LibraryPanelProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onCreatePlaylist(trimmed);
    setName("");
    setCreating(false);
  }

  return (
    <section className="cw-window cw-library" aria-label="Library">
      <TitleBar title="PLAYNEST LIBRARY" onClose={onClose} closeLabel="Hide library" />
      <div className="cw-library-body">
        <nav className="cw-library-nav" aria-label="Library">
          {NAV.map((item) => (
            <button
              key={item.key}
              className="cw-library-nav-item"
              aria-current={view === item.key ? "page" : undefined}
              onClick={() => onViewChange(item.key)}
            >
              {item.label}
            </button>
          ))}

          <div className="cw-library-nav-heading">
            <span className="cw-label">PLAYLISTS</span>
            <span className="flex gap-[3px]">
              <button className="cw-btn" onClick={onImportPlaylist} title="Import a YouTube playlist">
                IMP
              </button>
              <button
                className="cw-btn"
                onClick={() => setCreating((v) => !v)}
                aria-label="Create playlist"
                title="New playlist"
              >
                +
              </button>
            </span>
          </div>

          {creating && (
            <form onSubmit={handleCreate} className="px-[6px] pb-[4px]">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleCreate}
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
                placeholder="Playlist name"
                aria-label="Playlist name"
                maxLength={200}
                className="cw-lcd w-full h-[18px] px-[4px] text-[15px] outline-none"
                style={{ color: "var(--cw-lcd-text)" }}
              />
            </form>
          )}

          {playlists.length === 0 && !creating && (
            <p className="px-[8px] py-[3px]" style={{ color: "var(--cw-list-dim)" }}>
              No playlists yet.
            </p>
          )}
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="cw-library-nav-item"
              aria-current={view === "playlist" && selectedPlaylistId === playlist.id ? "page" : undefined}
              onClick={() => onSelectPlaylist(playlist.id)}
              title={playlist.name}
            >
              {playlist.name}
            </button>
          ))}
        </nav>

        <div className="cw-library-content">
          {children}
          {side}
        </div>
      </div>
    </section>
  );
}
