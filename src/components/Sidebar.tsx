import { FormEvent, useState } from "react";
import { Playlist } from "../lib/types";

export type NavKey =
  | "search"
  | "suggestions"
  | "queue"
  | "liked"
  | "downloads"
  | "recent"
  | "stats"
  | "sound"
  | "settings";

export type View = NavKey | "playlist" | "artist";

interface SidebarProps {
  view: View;
  onViewChange: (view: NavKey) => void;
  queueCount: number;
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  onSelectPlaylist: (id: number) => void;
  onCreatePlaylist: (name: string) => void;
  onImportPlaylist: () => void;
}

function NestMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="14" fill="#ff6f3c" />
      <rect x="10.5" y="9.5" width="2.6" height="9" rx="1.3" fill="#0e1016" />
      <rect x="14.7" y="6.5" width="2.6" height="15" rx="1.3" fill="#0e1016" />
    </svg>
  );
}

const MAIN_NAV: { key: NavKey; label: string }[] = [
  { key: "search", label: "Search" },
  { key: "suggestions", label: "Suggestions" },
  { key: "queue", label: "Queue" },
];

const LIBRARY_NAV: { key: NavKey; label: string }[] = [
  { key: "liked", label: "Liked Songs" },
  { key: "downloads", label: "Downloads" },
  { key: "recent", label: "Recently Played" },
  { key: "stats", label: "Stats" },
];

const FOOTER_NAV: { key: NavKey; label: string }[] = [
  { key: "sound", label: "Sound" },
  { key: "settings", label: "Settings" },
];

export default function Sidebar({
  view,
  onViewChange,
  queueCount,
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onImportPlaylist,
}: SidebarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onCreatePlaylist(trimmed);
    setName("");
    setCreating(false);
  }

  function navButton(item: { key: NavKey; label: string }, small = false) {
    const active = view === item.key;
    return (
      <button
        key={item.key}
        onClick={() => onViewChange(item.key)}
        aria-current={active ? "page" : undefined}
        className={`text-left px-3 ${small ? "py-1.5" : "py-2"} rounded-md text-sm font-medium transition-colors ${
          active ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-100 hover:bg-ink-800"
        }`}
      >
        {item.label}
        {item.key === "queue" && queueCount > 0 && (
          <span className="ml-2 text-xs text-ember">{queueCount}</span>
        )}
      </button>
    );
  }

  return (
    <aside className="w-60 shrink-0 bg-ink-950 border-r border-ink-700 flex flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <NestMark />
        <span className="font-display text-lg font-semibold tracking-tight">playnest</span>
      </div>

      <nav className="px-3 flex flex-col gap-0.5" aria-label="Main">
        {MAIN_NAV.map((item) => navButton(item))}
      </nav>

      <p className="mt-5 px-5 text-xs font-medium text-mist-500 uppercase tracking-wide">Library</p>
      <nav className="px-3 mt-1 flex flex-col gap-0.5" aria-label="Library">
        {LIBRARY_NAV.map((item) => navButton(item, true))}
      </nav>

      <div className="mt-5 px-3 flex items-center justify-between">
        <span className="px-2 text-xs font-medium text-mist-500 uppercase tracking-wide">Playlists</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onImportPlaylist}
            title="Import a YouTube playlist"
            className="px-2 h-6 text-xs rounded-full text-mist-500 hover:text-mist-100 hover:bg-ink-800"
          >
            Import
          </button>
          <button
            onClick={() => setCreating((v) => !v)}
            aria-label="Create playlist"
            title="New playlist"
            className="w-6 h-6 flex items-center justify-center rounded-full text-mist-500 hover:text-mist-100 hover:bg-ink-800"
          >
            +
          </button>
        </div>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="px-3 mt-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleCreate}
            placeholder="Playlist name"
            aria-label="Playlist name"
            className="w-full bg-ink-800 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-mist-100 placeholder:text-mist-500 focus:border-ember"
          />
        </form>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 mt-1">
        {playlists.length === 0 && !creating ? (
          <p className="px-2 py-2 text-xs text-mist-500">No playlists yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                onClick={() => onSelectPlaylist(playlist.id)}
                className={`text-left px-3 py-1.5 rounded-md text-sm truncate transition-colors ${
                  view === "playlist" && selectedPlaylistId === playlist.id
                    ? "bg-ink-700 text-mist-100"
                    : "text-mist-500 hover:text-mist-100 hover:bg-ink-800"
                }`}
              >
                {playlist.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="px-3 py-3 border-t border-ink-700 flex flex-col gap-0.5" aria-label="App">
        {FOOTER_NAV.map((item) => navButton(item, true))}
      </nav>
    </aside>
  );
}
