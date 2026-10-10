import { SleepTimer } from "../components/SleepTimerMenu";
import { Settings } from "../lib/settings";
import { Track } from "../lib/types";

export type RepeatMode = "off" | "all" | "one";

/** Everything the classic player windows show and can do. Built by App. */
export interface ClassicPlayer {
  track: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  liked: boolean;
  /** The current track plays from a download rather than the web. */
  isOffline: boolean;
  sleepTimer: SleepTimer;
  lyricsOpen: boolean;
  queue: Track[];
  likedTracks: Track[];
  downloadedTracks: Track[];
  analyser: AnalyserNode | null;
  /** Audio effects (EQ, levelling, visualizer) are running. */
  effectsAvailable: boolean;
  settings: Settings;

  onSettingsChange: (next: Settings) => void;
  /** ▶: resume, restart if already playing, or start the playlist. */
  onPlay: () => void;
  /** ❚❚: pause / resume. */
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLike: () => void;
  onToggleLyrics: () => void;
  onSetSleepTimer: (timer: SleepTimer) => void;
  onPlayFromQueue: (track: Track) => void;
  onQueueChange: (next: Track[]) => void;
  onSaveQueueAsPlaylist: (name: string) => Promise<void>;
  onImportPlaylist: () => void;
  onOpenArtist: (name: string) => void;
}
