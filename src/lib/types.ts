export interface Track {
  id: string;
  title: string;
  uploader: string;
  durationSeconds: number;
  thumbnail: string;
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string;
}

export interface PlaybackState {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
}

/** A recommended track, with a short human-readable reason it was picked —
 * shown in the Suggestions view so recommendations don't feel like a black
 * box (e.g. "Because you played Nirvana", "From your search history"). */
export interface Recommendation {
  track: Track;
  reason: string;
}
