import { createContext, useContext } from "react";
import { Playlist, Track } from "../lib/types";

/** Everything a track row needs to show its state (liked? downloaded?) and
 * act on a track, provided once by App instead of threaded through every
 * list view as props. */
export interface TrackActions {
  playlists: Playlist[];
  likedIds: Set<string>;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  toggleLike: (track: Track) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  openArtist: (name: string) => void;
  download: (track: Track) => void;
  removeDownload: (track: Track) => void;
  addToPlaylist: (playlistId: number, track: Track) => void;
  createPlaylistWith: (name: string, track: Track) => void;
}

export const TrackActionsContext = createContext<TrackActions | null>(null);

export function useTrackActions(): TrackActions {
  const value = useContext(TrackActionsContext);
  if (!value) throw new Error("useTrackActions must be used inside TrackActionsContext");
  return value;
}
