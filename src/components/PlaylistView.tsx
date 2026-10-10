import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { Playlist, Track } from "../lib/types";
import { useDragReorder } from "../lib/useDragReorder";
import ListPage, { PillButton } from "./ListPage";
import TrackRow from "./TrackRow";

interface PlaylistViewProps {
  playlist: Playlist | null;
  tracks: Track[];
  isLoading: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
  onPlayAll: (tracks: Track[]) => void;
  onRemove: (trackId: string) => void;
  onReorder: (next: Track[]) => void;
  onRename: (playlistId: number, name: string) => void;
  onDeletePlaylist: (playlistId: number) => void;
}

function PlaylistTitle({
  playlist,
  onRename,
}: {
  playlist: Playlist;
  onRename: (playlistId: number, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(playlist.name);

  useEffect(() => {
    setDraft(playlist.name);
    setEditing(false);
  }, [playlist.id, playlist.name]);

  function commit(e?: FormEvent) {
    e?.preventDefault();
    const name = draft.trim();
    if (name && name !== playlist.name) onRename(playlist.id, name);
    else setDraft(playlist.name);
    setEditing(false);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setDraft(playlist.name);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={commit} className="min-w-0 flex-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={handleKey}
          aria-label="Playlist name"
          className="w-full max-w-md font-display text-xl font-semibold bg-ink-800 border border-ink-700 rounded-md px-2 py-0.5 text-mist-100 focus:border-ember"
        />
      </form>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to rename"
      className="font-display text-xl font-semibold truncate text-left hover:text-ember-soft"
    >
      {playlist.name}
    </button>
  );
}

export default function PlaylistView({
  playlist,
  tracks,
  isLoading,
  currentTrackId,
  isPlaying,
  onPlay,
  onPlayAll,
  onRemove,
  onReorder,
  onRename,
  onDeletePlaylist,
}: PlaylistViewProps) {
  const { rowProps, indicatorFor, dragIndex } = useDragReorder(tracks, onReorder);

  if (!playlist) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-mist-500">Playlist not found.</p>
      </div>
    );
  }

  return (
    <ListPage
      title={<PlaylistTitle playlist={playlist} onRename={onRename} />}
      description={
        tracks.length > 0
          ? `${tracks.length} track${tracks.length === 1 ? "" : "s"} · click the name to rename, drag tracks to reorder`
          : undefined
      }
      headerActions={
        <>
          <PillButton primary onClick={() => onPlayAll(tracks)} disabled={tracks.length === 0}>
            Play all
          </PillButton>
          <PillButton onClick={() => onDeletePlaylist(playlist.id)}>Delete playlist</PillButton>
        </>
      }
      isLoading={isLoading}
      isEmpty={tracks.length === 0}
      emptyText="No tracks yet. Add some from any ⋯ menu."
    >
      {tracks.map((track, i) => (
        <TrackRow
          key={track.id}
          track={track}
          isCurrent={track.id === currentTrackId}
          isPlaying={isPlaying}
          onPlay={() => onPlay(track)}
          extraActions={[{ label: "Remove from this playlist", onClick: () => onRemove(track.id) }]}
          drag={rowProps(i)}
          dropIndicator={indicatorFor(i)}
          isDragging={dragIndex === i}
        />
      ))}
    </ListPage>
  );
}
