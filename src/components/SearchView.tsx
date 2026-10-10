import { FormEvent, KeyboardEvent, useState } from "react";
import { Track } from "../lib/types";
import TrackRow from "./TrackRow";

export interface YtdlpStatus {
  version: string | null;
  updating: boolean;
  message: string | null;
  failed: boolean;
}

interface SearchViewProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  /** Results after the Songs-only filter. */
  results: Track[];
  hiddenCount: number;
  hasSearched: boolean;
  isSearching: boolean;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  songsOnly: boolean;
  onToggleSongsOnly: () => void;
  recentSearches: string[];
  onRemoveRecent: (query: string) => void;
  onClearRecent: () => void;
  error: string | null;
  ytdlp: YtdlpStatus;
  onUpdateYtdlp: () => void;
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
}

export default function SearchView({
  query,
  onQueryChange,
  onSearch,
  results,
  hiddenCount,
  hasSearched,
  isSearching,
  canLoadMore,
  isLoadingMore,
  onLoadMore,
  songsOnly,
  onToggleSongsOnly,
  recentSearches,
  onRemoveRecent,
  onClearRecent,
  error,
  ytdlp,
  onUpdateYtdlp,
  currentTrackId,
  isPlaying,
  onPlay,
}: SearchViewProps) {
  const [focused, setFocused] = useState(false);

  const trimmed = query.trim().toLowerCase();
  const suggestions = recentSearches.filter(
    (q) => !trimmed || (q.toLowerCase().includes(trimmed) && q.toLowerCase() !== trimmed)
  );
  const showRecent = focused && suggestions.length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
    onSearch(query);
  }

  function pick(q: string) {
    onQueryChange(q);
    setFocused(false);
    onSearch(q);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") setFocused(false);
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="max-w-xl relative">
        <form onSubmit={submit}>
          <label htmlFor="search" className="sr-only">
            Search for a track
          </label>
          <input
            id="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKey}
            autoComplete="off"
            placeholder="Search for a song or artist"
            className="w-full bg-ink-800 border border-ink-700 rounded-full px-5 py-3 text-sm text-mist-100 placeholder:text-mist-500 focus:border-ember"
          />
        </form>

        {showRecent && (
          <div
            className="absolute left-0 right-0 top-full mt-2 z-30 bg-ink-800 border border-ink-700 rounded-xl shadow-xl py-2"
            // Keep the input focused while clicking inside the dropdown.
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between px-4 pb-1">
              <span className="text-xs font-medium text-mist-500 uppercase tracking-wide">Recent searches</span>
              <button onClick={onClearRecent} className="text-xs text-mist-500 hover:text-mist-100">
                Clear
              </button>
            </div>
            {suggestions.map((q) => (
              <div key={q} className="flex items-center group/recent hover:bg-ink-700">
                <button onClick={() => pick(q)} className="flex-1 text-left px-4 py-1.5 text-sm text-mist-100 truncate">
                  {q}
                </button>
                <button
                  onClick={() => onRemoveRecent(q)}
                  aria-label={`Remove "${q}" from recent searches`}
                  className="px-3 text-mist-500 hover:text-mist-100 opacity-0 group-hover/recent:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 max-w-xl">
        <button
          onClick={onToggleSongsOnly}
          aria-pressed={songsOnly}
          title="Hide full albums, concerts, hour-long mixes and live streams"
          className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
            songsOnly ? "bg-ember text-ink-950 border-ember" : "border-ink-600 text-mist-300 hover:border-mist-500"
          }`}
        >
          Songs only
        </button>
        {songsOnly && hiddenCount > 0 && (
          <span className="text-xs text-mist-500">
            {hiddenCount} long video{hiddenCount === 1 ? "" : "s"} hidden
          </span>
        )}
      </div>

      {error && (
        <div className="mt-6 max-w-xl bg-ink-800 border border-ink-700 rounded-xl px-4 py-3">
          <p className="text-sm text-ember-soft break-words">{error}</p>
          <p className="text-xs text-mist-500 mt-2">
            If searching or playing suddenly stopped working, YouTube probably changed something and
            yt-dlp needs an update.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={onUpdateYtdlp}
              disabled={ytdlp.updating}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-ember text-ink-950 hover:bg-ember-dim disabled:opacity-50"
            >
              {ytdlp.updating ? "Updating yt-dlp…" : "Update yt-dlp"}
            </button>
            {ytdlp.message && (
              <span className={`text-xs ${ytdlp.failed ? "text-ember-soft" : "text-mist-300"}`}>{ytdlp.message}</span>
            )}
          </div>
        </div>
      )}

      {isSearching && <p className="mt-6 text-sm text-mist-500">Searching…</p>}

      {!isSearching && results.length > 0 && (
        <>
          <ul className="mt-6 flex flex-col divide-y divide-ink-800 max-w-3xl">
            {results.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                onPlay={() => onPlay(track)}
              />
            ))}
          </ul>
          {canLoadMore && (
            <div className="max-w-3xl flex justify-center mt-4">
              <button
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="text-xs font-medium px-4 py-2 rounded-full border border-ink-600 text-mist-300 hover:border-mist-500 disabled:opacity-50"
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      {!isSearching && !error && results.length === 0 && (
        <p className="mt-16 text-sm text-mist-500 max-w-xl">
          {hasSearched && hiddenCount > 0
            ? "Everything here was a long video. Turn off Songs only to see them."
            : hasSearched
              ? "No results."
              : "Search to start building your queue."}
        </p>
      )}
    </div>
  );
}
