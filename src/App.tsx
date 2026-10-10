import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar, { NavKey, View } from "./components/Sidebar";
import SearchView from "./components/SearchView";
import QueueView from "./components/QueueView";
import PlaylistView from "./components/PlaylistView";
import SoundView from "./components/SoundView";
import { AudioGraph } from "./lib/audioGraph";
import LyricsPanel from "./components/LyricsPanel";
import SuggestionsView from "./components/SuggestionsView";
import StatsView from "./components/StatsView";
import SettingsView from "./components/SettingsView";
import ArtistView, { ArtistPageData } from "./components/ArtistView";
import { YtdlpStatus } from "./components/SearchView";
import WelcomePage from "./components/WelcomePage";
import EngineSetup, { EngineState } from "./components/EngineSetup";
import { ChangelogDialog, UpdateDialog } from "./components/UpdateDialogs";
import { getVersion } from "@tauri-apps/api/app";
import { describeUpdateError, findAppUpdate, installAppUpdate, Update } from "./lib/appUpdate";
import { CHANGELOG, changelogFor, ChangelogEntry } from "./lib/changelog";
import ImportPlaylistDialog from "./components/ImportPlaylistDialog";
import NowPlayingBar from "./components/NowPlayingBar";
import ListPage, { PillButton } from "./components/ListPage";
import TrackRow from "./components/TrackRow";
import { TrackActions, TrackActionsContext } from "./components/TrackActions";
import { SleepTimer } from "./components/SleepTimerMenu";
import { Playlist, Recommendation, Track } from "./lib/types";
import {
  addTrackToPlaylist,
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist as deletePlaylistFromDb,
  DownloadedTrack,
  fetchDownloads,
  fetchLikedTracks,
  fetchPlayLog,
  fetchPlaylistTracks,
  fetchPlaylists,
  fetchRecentlyPlayed,
  fetchSearchHistory,
  fetchRecentSearches,
  deleteSearchQuery,
  clearSearchHistory,
  hasCompletedOnboarding,
  likeTrack,
  loadAppState,
  markOnboardingComplete,
  recordDownload,
  recordRecentlyPlayed,
  recordSearchQuery,
  removeDownloadRecord,
  removeTrackFromPlaylist,
  renamePlaylist,
  replacePlaylistTracks,
  resetOnboarding,
  saveAppState,
  unlikeTrack,
} from "./lib/db";
import { clearDiscordPresence, updateDiscordPresence } from "./lib/discord";
import { fetchLyrics, Lyrics } from "./lib/lyrics";
import { buildRadio, buildRecommendations } from "./lib/recommendations";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from "./lib/settings";
import { computeStats, ListeningStats } from "./lib/stats";
import { fetchYourArtistTracks, searchArtistSongs } from "./lib/artist";
import { backupFileName, buildBackup, describeRestore, parseBackup, restoreBackup } from "./lib/backup";
import { cleanTrack, looksLikeSong } from "./lib/titles";
import ClassicLayout from "./classic/ClassicLayout";
import LibraryPanel from "./classic/LibraryPanel";
import { ClassicPlayer } from "./classic/types";
import { getWindowSize, setWindowDecorations, setWindowMinSize, setWindowSize } from "./classic/windowControls";

type RepeatMode = "off" | "all" | "one";

interface PersistedPlayerState {
  queue: Track[];
  currentTrack: Track | null;
  currentTime: number;
}

interface PlayOptions {
  /** Resume position in seconds. */
  startAt?: number;
  /** Push the outgoing track onto the Previous stack (false when going back). */
  recordBack?: boolean;
  /** Automatic advances (end of track, autoplay) keep a pending "pause"
   * the user pressed while loading; explicit plays clear it. */
  keepPauseRequest?: boolean;
}

/** Event emitted by the Rust side for tray menu clicks and global hotkeys. */
const PLAYER_ACTION_EVENT = "playnest://player-action";
/** Crossfades start this many seconds earlier than their length, to cover
 * the time it takes to look up the next stream. */
const CROSSFADE_LEAD_SECONDS = 3;
const FADE_TICK_MS = 50;
/** Pressing Previous later than this restarts the track instead. */
const RESTART_THRESHOLD_SECONDS = 3;
/** Search results per page ("Load more" fetches another page). */
const SEARCH_PAGE_SIZE = 15;
const SEARCH_MAX_RESULTS = 200;
/** The sleep timer fades out over this final stretch. */
const SLEEP_FADE_MS = 10_000;

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function App() {
  // --- onboarding / startup ---
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [view, setView] = useState<View>("search");
  const [toast, setToast] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  /** Classic layout: the library panel beside the player. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** yt-dlp: Playnest downloads its own copy on a PC that has none. */
  const [engine, setEngine] = useState<EngineState>({ status: "checking", downloaded: 0, total: null, error: null });
  const [engineSkipped, setEngineSkipped] = useState(false);
  const engineStartedRef = useRef(false);
  /** Playnest's own updates. */
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appUpdate, setAppUpdate] = useState<Update | null>(null);
  const [changelogView, setChangelogView] = useState<{ title: string; entries: ChangelogEntry[] } | null>(null);
  const updateStartedRef = useRef(false);
  /** Settings decide the layout, so nothing is drawn until they're read. */
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // --- search ---
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [ytdlp, setYtdlp] = useState<YtdlpStatus>({ version: null, updating: false, message: null, failed: false });

  const [artistPage, setArtistPage] = useState<ArtistPageData | null>(null);
  const [isLoadingArtist, setIsLoadingArtist] = useState(false);
  const [artistError, setArtistError] = useState<string | null>(null);

  // --- player ---
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sleepTimer, setSleepTimer] = useState<SleepTimer>(null);

  // --- library ---
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [downloads, setDownloads] = useState<DownloadedTrack[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // --- side panels / pages ---
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  /** Per-track lyrics timing nudges (seconds), keyed by track id. */
  const [lyricsOffsets, setLyricsOffsets] = useState<Record<string, number>>({});
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [hasListeningHistory, setHasListeningHistory] = useState(true);
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [graphAvailable, setGraphAvailable] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // --- audio engine refs ---
  /** Two elements so one can fade out while the other fades in. */
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  /** Web Audio processing (visualizer, EQ, levelling), when the relay runs. */
  const graphRef = useRef<AudioGraph | null>(null);
  /** Settles once we know whether the graph is in use; nothing may load
   * into the players before that, or they'd be wired up wrong. */
  const audioReadyRef = useRef<Promise<void>>(Promise.resolve());
  /** Whichever of the two is the "current" track. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeIntervalRef = useRef<number | null>(null);
  const fadeOutElRef = useRef<HTMLAudioElement | null>(null);
  /** Bumped on every play request; an older request that finishes late
   * checks this and backs off instead of overwriting the newer one. */
  const playRequestIdRef = useRef(0);
  /** True while the next track is being looked up / started. */
  const pendingAdvanceRef = useRef(false);
  /** True once this track has already asked for the next one (crossfade
   * start or end-of-track), so it can't ask twice. */
  const autoAdvanceTriggeredRef = useRef(false);
  /** Pause was pressed while the next track was loading: start it paused. */
  const pauseRequestedRef = useRef(false);
  const radioInFlightRef = useRef(false);

  const currentTrackRef = useRef<Track | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const currentTimeRef = useRef(0);
  const volumeRef = useRef(volume);
  const settingsRef = useRef(settings);
  const repeatModeRef = useRef(repeatMode);
  const sleepTimerRef = useRef(sleepTimer);
  const downloadsMapRef = useRef<Map<string, string>>(new Map());
  const restoredRef = useRef(false);
  const lyricsOpenRef = useRef(false);
  /** Whole second last drawn; the UI re-renders once a second, not on every timeupdate. */
  const renderedSecondRef = useRef(-1);
  /** Everything played, for "repeat all". */
  const playHistoryRef = useRef<Track[]>([]);
  /** Tracks to go back to with Previous. */
  const backStackRef = useRef<Track[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  /** The query behind the current results (the box may have been edited since). */
  const lastQueryRef = useRef("");
  /** How many raw results have been fetched for that query, for paging. */
  const searchFetchedRef = useRef(0);
  const searchRequestRef = useRef(0);
  const artistRequestRef = useRef(0);

  volumeRef.current = volume;
  settingsRef.current = settings;
  lyricsOpenRef.current = lyricsOpen;
  repeatModeRef.current = repeatMode;
  sleepTimerRef.current = sleepTimer;

  const likedIds = useMemo(() => new Set(likedTracks.map((t) => t.id)), [likedTracks]);
  const downloadedIds = useMemo(() => new Set(downloads.map((d) => d.track.id)), [downloads]);
  useEffect(() => {
    downloadsMapRef.current = new Map(downloads.map((d) => [d.track.id, d.filePath]));
  }, [downloads]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // --- onboarding: if the database can't open, show why instead of a blank screen ---
  useEffect(() => {
    (async () => {
      try {
        const completed = await hasCompletedOnboarding();
        setShowWelcome(!completed);
      } catch (err) {
        console.error("Failed to open local database", err);
        setDbError(errorText(err));
      } finally {
        setOnboardingChecked(true);
      }
    })();
  }, []);

  // --- yt-dlp: make sure it's there, downloading Playnest's own copy if not ---
  const installEngine = useCallback(async () => {
    setEngine({ status: "installing", downloaded: 0, total: null, error: null });
    try {
      const version = await invoke<string>("install_ytdlp");
      setEngine((e) => ({ ...e, status: "ready" }));
      setYtdlp((prev) => ({ ...prev, version, message: null, failed: false }));
    } catch (err) {
      setEngine((e) => ({ ...e, status: "failed", error: errorText(err) }));
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ downloaded: number; total: number | null }>("playnest://ytdlp-progress", (event) => {
      setEngine((e) => (e.status === "installing" ? { ...e, ...event.payload } : e));
    })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch(() => {});

    // StrictMode runs effects twice in development; only check once.
    if (!engineStartedRef.current) {
      engineStartedRef.current = true;
      invoke<{ available: boolean }>("ytdlp_status")
        .then((status) => {
          if (status.available) setEngine((e) => ({ ...e, status: "ready" }));
          else installEngine();
        })
        .catch(() => installEngine());
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [installEngine]);

  const showEngineSetup = (engine.status === "installing" || engine.status === "failed") && !engineSkipped;

  // --- Playnest's own updates ---

  /** Returns a message for a manual check; automatic checks stay quiet. */
  async function checkForAppUpdate(manual: boolean): Promise<string | null> {
    try {
      const update = await findAppUpdate();
      saveAppState("lastUpdateCheck", Date.now()).catch(() => {});
      if (!update) return manual ? "You have the latest version." : null;
      if (!manual && (await loadAppState<string>("skippedUpdate")) === update.version) return null;
      setAppUpdate(update);
      return manual ? `Playnest ${update.version} is available.` : null;
    } catch (err) {
      if (manual) return describeUpdateError(err);
      console.warn("Update check failed", err);
      return null;
    }
  }

  // After launch: show "What's new" once after an update, and check for a
  // new version at most every 12 hours (a little after startup).
  useEffect(() => {
    if (!settingsLoaded || showWelcome || dbError || updateStartedRef.current) return;
    updateStartedRef.current = true;
    let timer: number | undefined;
    (async () => {
      try {
        const version = await getVersion();
        setAppVersion(version);
        const lastSeen = await loadAppState<string>("lastSeenVersion");
        const entry = changelogFor(version);
        if (lastSeen && lastSeen !== version && entry) {
          setChangelogView({ title: `Updated to Playnest ${version}`, entries: [entry] });
        }
        if (lastSeen !== version) await saveAppState("lastSeenVersion", version);
        const lastCheck = await loadAppState<number>("lastUpdateCheck");
        if (!lastCheck || Date.now() - lastCheck > 12 * 60 * 60 * 1000) {
          timer = window.setTimeout(() => checkForAppUpdate(false), 8000);
        }
      } catch (err) {
        console.warn("Couldn't read the app version", err);
      }
    })();
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, showWelcome, dbError]);

  function handleGetStarted() {
    setShowWelcome(false);
    markOnboardingComplete().catch((err) => console.warn("Failed to persist onboarding state", err));
  }

  function handleShowWelcomeAgain() {
    resetOnboarding().catch((err) => console.warn("Failed to reset onboarding", err));
    setShowWelcome(true);
  }

  // --- fades ---

  /** Player volume goes through the audio graph when it's active (the
   * element's own volume is then fixed at 1), otherwise the element. */
  const setLevel = (el: HTMLAudioElement, value: number) => {
    if (graphRef.current) graphRef.current.setLevel(el, value);
    else el.volume = value;
  };
  const getLevel = (el: HTMLAudioElement) => (graphRef.current ? graphRef.current.getLevel(el) : el.volume);

  /** End any fade in progress right now: silence the outgoing track and
   * put the current one at full volume. */
  const stopFade = useCallback(() => {
    if (fadeIntervalRef.current !== null) {
      window.clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    const outgoing = fadeOutElRef.current;
    if (outgoing) {
      outgoing.pause();
      outgoing.removeAttribute("src");
      outgoing.load();
      fadeOutElRef.current = null;
    }
    if (audioRef.current) setLevel(audioRef.current, volumeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Equal-power crossfade. Time-based rather than tick-counted, so it
   * still finishes on time if the window is minimized and timers slow down. */
  const startFade = useCallback(
    (outgoing: HTMLAudioElement, incoming: HTMLAudioElement, seconds: number) => {
      const startedAt = performance.now();
      const durationMs = seconds * 1000;
      const outgoingStart = Math.min(getLevel(outgoing), volumeRef.current);
      fadeOutElRef.current = outgoing;
      fadeIntervalRef.current = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - startedAt) / durationMs);
        const v = volumeRef.current;
        setLevel(incoming, v * Math.sin((t * Math.PI) / 2));
        setLevel(outgoing, outgoingStart * Math.cos((t * Math.PI) / 2));
        if (t >= 1) stopFade();
      }, FADE_TICK_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopFade]
  );

  /** Stream URL for a track, via the audio relay when it's running. */
  const resolveStream = useCallback(async (videoId: string) => {
    const source = await invoke<{ url: string; relayed: boolean }>("resolve_stream", { videoId });
    // Once players are wired into the audio graph, un-relayed audio would
    // come out silent, so treat it as a failure instead.
    if (graphRef.current && !source.relayed) throw new Error("audio relay unavailable");
    return source.url;
  }, []);

  /** A downloaded copy plays from disk (works offline); otherwise stream. */
  const resolveSource = useCallback(async (track: Track) => {
    const local = downloadsMapRef.current.get(track.id);
    if (local) {
      try {
        const source = await invoke<{ url: string; relayed: boolean }>("relay_local_file", { filePath: local });
        if (source.relayed) return { src: source.url, isLocal: true };
      } catch (err) {
        console.warn("Downloaded file unavailable, streaming instead", err);
      }
      if (!graphRef.current) return { src: convertFileSrc(local), isLocal: true };
    }
    return { src: await resolveStream(track.id), isLocal: false };
  }, [resolveStream]);

  // --- core playback ---

  const playTrack = useCallback(
    async (track: Track, opts: PlayOptions = {}) => {
      const els = audioElsRef.current;
      const active = audioRef.current;
      if (els.length < 2 || !active) return;

      const { startAt = 0, recordBack = true, keepPauseRequest = false } = opts;
      // Must run synchronously inside the click that started playback, or
      // the browser keeps the audio graph (and so all sound) suspended.
      graphRef.current?.resume();
      const requestId = ++playRequestIdRef.current;
      pendingAdvanceRef.current = true;
      if (!keepPauseRequest) pauseRequestedRef.current = false;

      const previous = currentTrackRef.current;
      if (recordBack && previous && previous.id !== track.id) {
        backStackRef.current.push(previous);
        if (backStackRef.current.length > 100) backStackRef.current.shift();
      }
      currentTrackRef.current = track;
      playHistoryRef.current.push(track);
      if (playHistoryRef.current.length > 200) playHistoryRef.current.shift();

      const crossfade = settingsRef.current.crossfadeSeconds;
      const willFade = crossfade > 0 && startAt === 0 && !active.paused && !!active.currentSrc;

      if (!willFade) {
        // Hard switch: stop what's playing now and show the new track
        // straight away while its stream is looked up.
        stopFade();
        active.pause();
        setCurrentTrack(track);
        setIsLoadingStream(true);
        setCurrentTime(startAt);
        currentTimeRef.current = startAt;
      }
      // With a crossfade the old track keeps playing (and stays on screen)
      // until the new one actually starts.

      try {
        await audioReadyRef.current;
        let source = await resolveSource(track);
        if (requestId !== playRequestIdRef.current) return;

        const incoming = willFade ? (els[0] === active ? els[1] : els[0]) : active;
        if (willFade) stopFade(); // finish any earlier fade before reusing an element

        const load = async (src: string) => {
          incoming.src = src;
          setLevel(incoming, willFade ? 0 : volumeRef.current);
          if (startAt > 0) incoming.currentTime = startAt;
          await incoming.play();
        };

        try {
          await load(source.src);
        } catch (err) {
          if (!source.isLocal) throw err;
          // Downloaded file missing or unreadable: fall back to streaming.
          console.warn("Local file failed, streaming instead", err);
          source = { src: await resolveStream(track.id), isLocal: false };
          if (requestId !== playRequestIdRef.current) return;
          await load(source.src);
        }

        if (requestId !== playRequestIdRef.current) {
          if (incoming !== audioRef.current) incoming.pause();
          return;
        }

        audioRef.current = incoming;
        autoAdvanceTriggeredRef.current = false;
        loadedTrackIdRef.current = track.id;
        graphRef.current?.resetLoudness();

        if (pauseRequestedRef.current) {
          // Pause was pressed while this was loading: land on it, paused.
          pauseRequestedRef.current = false;
          stopFade();
          incoming.pause();
          setCurrentTrack(track);
          setIsPlaying(false);
          recordRecentlyPlayed(track).catch((err) => console.warn("Failed to log play", err));
          return;
        }

        if (willFade) {
          const remaining = Number.isFinite(active.duration)
            ? active.duration - active.currentTime
            : crossfade;
          startFade(active, incoming, Math.max(0.5, Math.min(crossfade, remaining)));
          setCurrentTrack(track);
          setCurrentTime(startAt);
          currentTimeRef.current = startAt;
        }
        setIsPlaying(true);
        recordRecentlyPlayed(track).catch((err) => console.warn("Failed to log play", err));
      } catch (err) {
        if (requestId !== playRequestIdRef.current) return;
        console.error("Failed to play track", err);
        setCurrentTrack(track);
        setIsPlaying(false);
        showToast(`Couldn't play "${cleanTrack(track).title}".`);
      } finally {
        if (requestId === playRequestIdRef.current) {
          setIsLoadingStream(false);
          pendingAdvanceRef.current = false;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveSource, resolveStream, startFade, stopFade, showToast]
  );

  /** Queue up tracks like the one that just played, then start the first. */
  const startRadio = useCallback(
    async (seed: Track) => {
      if (radioInFlightRef.current) return;
      radioInFlightRef.current = true;
      const requestId = playRequestIdRef.current;
      pendingAdvanceRef.current = true;
      setIsLoadingStream(true);
      try {
        const recent = [...backStackRef.current.slice(-50), ...playHistoryRef.current.slice(-50)];
        const tracks = await buildRadio(seed, new Set(recent.map((t) => t.id)));
        if (requestId !== playRequestIdRef.current) return; // user picked something else meanwhile
        if (tracks.length === 0) {
          showToast("Autoplay couldn't find anything to play next.");
          if (!audioRef.current || audioRef.current.ended) setIsPlaying(false);
          return;
        }
        const [first, ...rest] = tracks;
        setQueue(rest);
        showToast(`Autoplay: more like ${cleanTrack(seed).artist}`);
        playTrack(first, { keepPauseRequest: true });
      } catch (err) {
        console.warn("Autoplay failed", err);
        if (!audioRef.current || audioRef.current.ended) setIsPlaying(false);
      } finally {
        radioInFlightRef.current = false;
        if (requestId === playRequestIdRef.current) {
          pendingAdvanceRef.current = false;
          setIsLoadingStream(false);
        }
      }
    },
    [playTrack, showToast]
  );

  /** Advance to the next track. Returns false if there was nothing to play. */
  const skipNext = useCallback(
    (opts: { auto?: boolean } = {}): boolean => {
      let upcoming = queue;
      if (upcoming.length === 0 && repeatMode === "all" && playHistoryRef.current.length > 0) {
        upcoming = [...playHistoryRef.current];
        playHistoryRef.current = [];
      }

      if (upcoming.length > 0) {
        const index = shuffle ? Math.floor(Math.random() * upcoming.length) : 0;
        const next = upcoming[index];
        setQueue([...upcoming.slice(0, index), ...upcoming.slice(index + 1)]);
        playTrack(next, { keepPauseRequest: opts.auto });
        return true;
      }

      if (settingsRef.current.autoplay && currentTrackRef.current) {
        startRadio(currentTrackRef.current);
        return true;
      }

      if (!opts.auto) {
        audioRef.current?.pause();
        stopFade();
        setIsPlaying(false);
      }
      return false;
    },
    [queue, shuffle, repeatMode, playTrack, startRadio, stopFade]
  );

  function seek(seconds: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setCurrentTime(seconds);
    currentTimeRef.current = seconds;
    if (!pendingAdvanceRef.current) autoAdvanceTriggeredRef.current = false;
  }

  function skipPrevious() {
    if (currentTimeRef.current > RESTART_THRESHOLD_SECONDS) {
      seek(0);
      return;
    }
    const previous = backStackRef.current.pop();
    if (!previous) {
      seek(0);
      return;
    }
    const current = currentTrackRef.current;
    if (current) setQueue((q) => [current, ...q.filter((t) => t.id !== current.id)]);
    playTrack(previous, { recordBack: false });
  }

  function togglePlay() {
    const el = audioRef.current;
    const track = currentTrackRef.current;
    if (!el || !track) return;

    // Something is loading: a press means "pause", both for whatever is
    // still audible (e.g. during a crossfade lead-in) and for the track
    // that's about to start.
    if (pendingAdvanceRef.current) {
      pauseRequestedRef.current = true;
      el.pause();
      stopFade();
      setIsPlaying(false);
      return;
    }

    // A track restored from last session hasn't been loaded yet.
    if (loadedTrackIdRef.current !== track.id) {
      playTrack(track, { startAt: currentTimeRef.current, recordBack: false });
      return;
    }

    if (!el.paused) {
      el.pause();
      stopFade();
      setIsPlaying(false);
    } else {
      graphRef.current?.resume();
      el.play().catch((err) => console.warn("Resume failed", err));
      setIsPlaying(true);
    }
  }

  function playAll(tracks: Track[], forceShuffle = false) {
    if (tracks.length === 0) return;
    const ordered = [...tracks];
    if (shuffle || forceShuffle) {
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }
    const [first, ...rest] = ordered;
    setQueue(rest);
    playTrack(first);
  }

  /** Playing from a list queues the rest of that list, so Next has
   * somewhere to go. */
  function playFromList(list: Track[], track: Track) {
    const index = list.findIndex((t) => t.id === track.id);
    setQueue(index === -1 ? [] : list.slice(index + 1));
    playTrack(track);
  }

  function playFromQueue(track: Track) {
    const index = queue.findIndex((t) => t.id === track.id);
    if (index !== -1) setQueue(queue.slice(index + 1));
    playTrack(track);
  }

  function playNext(track: Track) {
    if (!currentTrackRef.current) {
      playTrack(track);
      return;
    }
    setQueue((prev) => [track, ...prev.filter((t) => t.id !== track.id)]);
    showToast(`Playing "${cleanTrack(track).title}" next`);
  }

  function addToQueue(track: Track) {
    setQueue((prev) => (prev.some((t) => t.id === track.id) ? prev : [...prev, track]));
    showToast(`Added "${cleanTrack(track).title}" to the queue`);
  }

  function removeFromQueue(trackId: string) {
    setQueue((prev) => prev.filter((t) => t.id !== trackId));
  }

  /** ■: pause and go back to the start of the track. */
  function stop() {
    const el = audioRef.current;
    if (pendingAdvanceRef.current) pauseRequestedRef.current = true;
    stopFade();
    el?.pause();
    setIsPlaying(false);
    if (el && loadedTrackIdRef.current === currentTrackRef.current?.id) {
      seek(0);
    } else {
      setCurrentTime(0);
      currentTimeRef.current = 0;
    }
  }

  /** Classic ▶: resume when paused or stopped, restart when already playing,
   * and start the playlist when nothing is loaded. */
  function classicPlay() {
    if (!currentTrackRef.current) {
      if (queue.length > 0) playFromQueue(queue[0]);
      else openLibrary("search");
      return;
    }
    if (pendingAdvanceRef.current) {
      // Loading: cancel any pause pressed meanwhile, so it starts.
      pauseRequestedRef.current = false;
      return;
    }
    if (isPlaying) seek(0);
    else togglePlay();
  }

  // --- end of track & crossfade trigger ---

  function handleTrackEnded() {
    const el = audioRef.current;
    if (!el || pendingAdvanceRef.current) return;

    if (sleepTimerRef.current?.kind === "endOfTrack") {
      setSleepTimer(null);
      setIsPlaying(false);
      showToast("Sleep timer: stopped at the end of the track.");
      return;
    }
    if (repeatModeRef.current === "one") {
      el.currentTime = 0;
      el.play().catch(() => setIsPlaying(false));
      return;
    }
    // Already asked for the next track (crossfade) and nothing came of it.
    if (autoAdvanceTriggeredRef.current) {
      setIsPlaying(false);
      return;
    }
    autoAdvanceTriggeredRef.current = true;
    if (!skipNext({ auto: true })) setIsPlaying(false);
  }

  function maybeStartCrossfade(el: HTMLAudioElement) {
    const crossfade = settingsRef.current.crossfadeSeconds;
    if (crossfade <= 0 || pendingAdvanceRef.current || autoAdvanceTriggeredRef.current) return;
    if (repeatModeRef.current === "one" || sleepTimerRef.current?.kind === "endOfTrack") return;
    // Very short tracks just play out normally.
    if (!Number.isFinite(el.duration) || el.duration < crossfade * 2 + 10) return;
    if (el.duration - el.currentTime > crossfade + CROSSFADE_LEAD_SECONDS) return;
    autoAdvanceTriggeredRef.current = true;
    skipNext({ auto: true });
  }

  // Handlers for listeners that are attached once (audio events, keyboard,
  // tray/hotkeys) read the latest versions through this ref.
  const latest = useRef({
    togglePlay,
    seek,
    skipNext,
    skipPrevious,
    handleTrackEnded,
    maybeStartCrossfade,
    toggleLikeCurrent: () => {},
  });

  // --- audio elements: created once, both share the same listeners ---
  useEffect(() => {
    const els = [new Audio(), new Audio()];
    els.forEach((el) => (el.volume = volumeRef.current));
    audioElsRef.current = els;
    audioRef.current = els[0];

    // Audio effects need the relay; without it, play the plain elements.
    let cancelled = false;
    audioReadyRef.current = invoke<boolean>("relay_available")
      .then((available) => {
        if (!available || cancelled) return;
        const graph = new AudioGraph(els);
        els.forEach((el) => graph.setLevel(el, volumeRef.current));
        graphRef.current = graph;
        setGraphAvailable(true);
      })
      .catch((err) => console.warn("Audio effects unavailable", err));

    const onTimeUpdate = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      if (el !== audioRef.current) return;
      currentTimeRef.current = el.currentTime;
      // Re-rendering the whole app ~4 times a second costs CPU for nothing
      // the eye can see; once a second is enough, except for lyrics timing.
      const second = Math.floor(el.currentTime);
      if (lyricsOpenRef.current || second !== renderedSecondRef.current) {
        renderedSecondRef.current = second;
        setCurrentTime(el.currentTime);
      }
      latest.current.maybeStartCrossfade(el);
    };
    const onEnded = (e: Event) => {
      if (e.currentTarget !== audioRef.current) return;
      latest.current.handleTrackEnded();
    };
    const onPlaying = () => {
      const graph = graphRef.current;
      if (!graph || graph.isRunning) return;
      graph.resume();
      window.setTimeout(() => {
        if (graphRef.current && !graphRef.current.isRunning) {
          showToast("Click anywhere in Playnest to turn the sound on.");
        }
      }, 600);
    };
    const onError = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      if (el !== audioRef.current || pendingAdvanceRef.current || !el.currentSrc) return;
      setIsPlaying(false);
      showToast("Playback stopped: the stream couldn't be loaded.");
    };

    els.forEach((el) => {
      el.addEventListener("timeupdate", onTimeUpdate);
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onError);
      el.addEventListener("playing", onPlaying);
    });
    // Any click or key press counts as the gesture browsers want before
    // audio may start; keep the graph awake whenever that happens.
    const wake = () => graphRef.current?.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      graphRef.current?.close();
      graphRef.current = null;
      if (fadeIntervalRef.current !== null) window.clearInterval(fadeIntervalRef.current);
      els.forEach((el) => {
        el.removeEventListener("timeupdate", onTimeUpdate);
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
        el.removeEventListener("playing", onPlaying);
        el.pause();
      });
    };
  }, [showToast]);

  // Volume changes apply immediately unless a fade is steering volume.
  useEffect(() => {
    if (fadeIntervalRef.current === null && audioRef.current) setLevel(audioRef.current, volume);
    if (restoredRef.current) {
      const id = window.setTimeout(() => saveAppState("volume", volume).catch(() => {}), 400);
      return () => window.clearTimeout(id);
    }
  }, [volume]);

  // --- restore library + last session on launch ---
  useEffect(() => {
    (async () => {
      try {
        const [savedPlaylists, savedSettings, savedVolume, liked, downloaded, state, offsets] = await Promise.all([
          fetchPlaylists(),
          loadSettings(),
          loadAppState<number>("volume"),
          fetchLikedTracks(),
          fetchDownloads(),
          loadAppState<PersistedPlayerState>("player"),
          loadAppState<Record<string, number>>("lyricsOffsets"),
        ]);
        if (offsets) setLyricsOffsets(offsets);
        fetchRecentSearches().then(setRecentSearches).catch(() => {});
        setPlaylists(savedPlaylists);
        setSettings(savedSettings);
        if (typeof savedVolume === "number") setVolume(savedVolume);
        setLikedTracks(liked);
        setDownloads(downloaded);
        if (state) {
          setQueue(state.queue ?? []);
          setCurrentTrack(state.currentTrack ?? null);
          currentTrackRef.current = state.currentTrack ?? null;
          setCurrentTime(state.currentTime ?? 0);
          currentTimeRef.current = state.currentTime ?? 0;
        }
      } catch (err) {
        console.error("Failed to restore previous session", err);
      } finally {
        restoredRef.current = true;
        setSettingsLoaded(true);
      }
    })();
  }, []);

  // --- persist queue/current track ---
  useEffect(() => {
    if (!restoredRef.current) return;
    saveAppState("player", { queue, currentTrack, currentTime: currentTimeRef.current }).catch(() => {});
  }, [queue, currentTrack]);

  useEffect(() => {
    if (!currentTrack) return;
    const interval = window.setInterval(() => {
      saveAppState("player", { queue, currentTrack, currentTime: currentTimeRef.current }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [currentTrack, queue]);

  // --- sleep timer (timed): fade out over the last 10s, then pause ---
  useEffect(() => {
    if (sleepTimer?.kind !== "minutes") return;
    const id = window.setInterval(() => {
      const el = audioRef.current;
      const remaining = sleepTimer.endsAt - Date.now();
      if (remaining <= 0) {
        if (pendingAdvanceRef.current) pauseRequestedRef.current = true;
        stopFade();
        el?.pause();
        if (el) setLevel(el, volumeRef.current);
        setIsPlaying(false);
        setSleepTimer(null);
        showToast("Sleep timer: playback paused.");
      } else if (remaining <= SLEEP_FADE_MS && el && fadeIntervalRef.current === null) {
        setLevel(el, volumeRef.current * (remaining / SLEEP_FADE_MS));
      }
    }, 250);
    return () => {
      window.clearInterval(id);
      if (audioRef.current && fadeIntervalRef.current === null) setLevel(audioRef.current, volumeRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepTimer, stopFade, showToast]);

  // --- apply sound settings to the audio graph ---
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.setEq(settings.eqEnabled, settings.eqGains, settings.eqPreamp);
    graph.setLevelling(settings.levelling);
  }, [graphAvailable, settings.eqEnabled, settings.eqGains, settings.eqPreamp, settings.levelling]);

  // --- layout & skin ---
  useEffect(() => {
    const root = document.documentElement;
    for (const cls of [...root.classList]) if (cls === "layout-classic" || cls.startsWith("skin-")) root.classList.remove(cls);
    if (settings.layout === "classic") root.classList.add("layout-classic", `skin-${settings.skin}`);
  }, [settings.layout, settings.skin]);

  // The classic player sizes its own frameless window (ClassicLayout); every
  // other screen gets a normal window frame and enough room.
  const needsFramedWindow = !!dbError || showWelcome || showEngineSetup || settings.layout !== "classic";
  useEffect(() => {
    if (!onboardingChecked || (!settingsLoaded && !dbError) || !needsFramedWindow) return;
    let cancelled = false;
    (async () => {
      await setWindowDecorations(true);
      const size = await getWindowSize();
      if (!size || cancelled) return;
      const compact = showWelcome || showEngineSetup || !!dbError;
      const target = compact ? { width: 1000, height: 720 } : { width: 1200, height: 780 };
      await setWindowMinSize(compact ? 420 : 900, compact ? 560 : 600);
      if (cancelled) return;
      if (size.width < target.width || size.height < target.height) {
        await setWindowSize(Math.max(size.width, target.width), Math.max(size.height, target.height));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsFramedWindow, showWelcome, showEngineSetup, dbError, onboardingChecked, settingsLoaded]);

  function handleSetSleepTimer(timer: SleepTimer) {
    setSleepTimer(timer);
    if (timer?.kind === "minutes") {
      showToast(`Sleep timer set for ${Math.round((timer.endsAt - Date.now()) / 60000)} minutes`);
    } else if (timer?.kind === "endOfTrack") {
      showToast("Playback will stop at the end of this track");
    }
  }

  // --- search ---

  function rememberSearch(query: string) {
    recordSearchQuery(query).catch((err) => console.warn("Failed to record search", err));
    setRecentSearches((prev) =>
      [query, ...prev.filter((q) => q.toLowerCase() !== query.toLowerCase())].slice(0, 8)
    );
  }

  async function handleSearch(rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) return;
    const requestId = ++searchRequestRef.current;
    setSearchQuery(query);
    setView("search");
    setIsSearching(true);
    setSearchError(null);
    setCanLoadMore(false);
    try {
      const tracks = await invoke<Track[]>("search_tracks", { query, offset: 0, limit: SEARCH_PAGE_SIZE });
      if (requestId !== searchRequestRef.current) return;
      lastQueryRef.current = query;
      searchFetchedRef.current = SEARCH_PAGE_SIZE;
      setResults(tracks);
      setHasSearched(true);
      setCanLoadMore(tracks.length > 0);
      rememberSearch(query);
    } catch (err) {
      if (requestId !== searchRequestRef.current) return;
      setResults([]);
      setSearchError(
        typeof err === "string" ? err : "Search failed. Make sure yt-dlp is installed and on your PATH."
      );
    } finally {
      if (requestId === searchRequestRef.current) setIsSearching(false);
    }
  }

  async function loadMoreResults() {
    const query = lastQueryRef.current;
    if (!query || isLoadingMore) return;
    const requestId = searchRequestRef.current;
    setIsLoadingMore(true);
    try {
      const offset = searchFetchedRef.current;
      const page = await invoke<Track[]>("search_tracks", { query, offset, limit: SEARCH_PAGE_SIZE });
      if (requestId !== searchRequestRef.current) return;
      searchFetchedRef.current = offset + SEARCH_PAGE_SIZE;
      // Count new tracks here, not inside the state updater (React may run
      // that later, after this check).
      const seen = new Set(results.map((t) => t.id));
      const fresh = page.filter((t) => !seen.has(t.id));
      setResults((prev) => {
        const prevIds = new Set(prev.map((t) => t.id));
        return [...prev, ...fresh.filter((t) => !prevIds.has(t.id))];
      });
      setCanLoadMore(fresh.length > 0 && searchFetchedRef.current < SEARCH_MAX_RESULTS);
    } catch (err) {
      showToast(`Couldn't load more: ${errorText(err).slice(0, 120)}`);
    } finally {
      setIsLoadingMore(false);
    }
  }

  function removeRecentSearch(query: string) {
    setRecentSearches((prev) => prev.filter((q) => q.toLowerCase() !== query.toLowerCase()));
    deleteSearchQuery(query).catch((err) => console.warn("Failed to remove search", err));
  }

  function clearRecentSearches() {
    setRecentSearches([]);
    clearSearchHistory().catch((err) => console.warn("Failed to clear searches", err));
  }

  async function loadYtdlpVersion() {
    try {
      const version = await invoke<string>("ytdlp_version");
      setYtdlp((prev) => ({ ...prev, version }));
    } catch (err) {
      setYtdlp((prev) => ({ ...prev, version: null, message: errorText(err), failed: true }));
    }
  }

  async function updateYtdlp() {
    setYtdlp((prev) => ({ ...prev, updating: true, message: "Checking for a new version… this can take a minute.", failed: false }));
    try {
      const result = await invoke<{ updated: boolean; version: string; message: string }>("update_ytdlp");
      setYtdlp({ version: result.version, updating: false, message: result.message, failed: false });
      // If a search had failed, try it again with the fresh version.
      if (searchError && lastQueryRef.current) handleSearch(lastQueryRef.current);
      else if (searchError && searchQuery) handleSearch(searchQuery);
    } catch (err) {
      setYtdlp((prev) => ({ ...prev, updating: false, message: errorText(err), failed: true }));
    }
  }

  async function openArtist(name: string) {
    const requestId = ++artistRequestRef.current;
    setView("artist");
    setArtistPage({ name, yours: [], popular: [] });
    setArtistError(null);
    setIsLoadingArtist(true);

    fetchYourArtistTracks(name)
      .then((yours) => {
        if (requestId === artistRequestRef.current) setArtistPage((prev) => (prev ? { ...prev, yours } : prev));
      })
      .catch((err) => console.warn("Failed to load your plays for artist", err));

    try {
      const popular = await searchArtistSongs(name);
      if (requestId === artistRequestRef.current) setArtistPage((prev) => (prev ? { ...prev, popular } : prev));
    } catch (err) {
      if (requestId === artistRequestRef.current) setArtistError(errorText(err));
    } finally {
      if (requestId === artistRequestRef.current) setIsLoadingArtist(false);
    }
  }

  // --- liked songs ---

  async function toggleLike(track: Track) {
    const wasLiked = likedIds.has(track.id);
    setLikedTracks((prev) => (wasLiked ? prev.filter((t) => t.id !== track.id) : [track, ...prev]));
    try {
      if (wasLiked) await unlikeTrack(track.id);
      else await likeTrack(track);
    } catch (err) {
      console.error("Failed to update like", err);
      setLikedTracks((prev) => (wasLiked ? [track, ...prev] : prev.filter((t) => t.id !== track.id)));
      showToast("Couldn't save that. Try again.");
    }
  }

  // --- downloads ---

  async function downloadTrack(track: Track) {
    if (downloadedIds.has(track.id) || downloadingIds.has(track.id)) return;
    setDownloadingIds((prev) => new Set(prev).add(track.id));
    showToast(`Downloading "${cleanTrack(track).title}"…`);
    try {
      const filePath = await invoke<string>("download_track", { videoId: track.id });
      await recordDownload(track, filePath);
      setDownloads((prev) => [{ track, filePath }, ...prev.filter((d) => d.track.id !== track.id)]);
      showToast(`Downloaded "${cleanTrack(track).title}". It'll play offline now.`);
    } catch (err) {
      console.error("Download failed", err);
      showToast(`Download failed: ${errorText(err).slice(0, 140)}`);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  }

  async function removeDownload(track: Track) {
    const entry = downloads.find((d) => d.track.id === track.id);
    if (!entry) return;
    try {
      await invoke("delete_download", { filePath: entry.filePath });
      await removeDownloadRecord(track.id);
      setDownloads((prev) => prev.filter((d) => d.track.id !== track.id));
      showToast("Download removed");
    } catch (err) {
      console.error("Failed to remove download", err);
      showToast("Couldn't delete the file. It may be playing right now; try again after skipping it.");
    }
  }

  // --- playlists ---

  async function refreshPlaylists() {
    setPlaylists(await fetchPlaylists());
  }

  async function loadTracksForPlaylist(playlistId: number) {
    setIsLoadingPlaylistTracks(true);
    try {
      setPlaylistTracks(await fetchPlaylistTracks(playlistId));
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
  }

  function selectPlaylist(id: number) {
    setView("playlist");
    setSelectedPlaylistId(id);
    loadTracksForPlaylist(id);
  }

  async function handleCreatePlaylist(name: string) {
    await createPlaylist(name);
    await refreshPlaylists();
  }

  async function handleAddToPlaylist(playlistId: number, track: Track) {
    await addTrackToPlaylist(playlistId, track);
    if (selectedPlaylistId === playlistId) await loadTracksForPlaylist(playlistId);
    const name = playlists.find((p) => p.id === playlistId)?.name ?? "playlist";
    showToast(`Added to ${name}`);
  }

  async function handleCreatePlaylistAndAdd(name: string, track: Track) {
    const id = await createPlaylist(name);
    await addTrackToPlaylist(id, track);
    await refreshPlaylists();
    showToast(`Created ${name}`);
  }

  async function handleRemoveFromPlaylist(trackId: string) {
    if (selectedPlaylistId === null) return;
    await removeTrackFromPlaylist(selectedPlaylistId, trackId);
    await loadTracksForPlaylist(selectedPlaylistId);
  }

  async function handleReorderPlaylist(next: Track[]) {
    if (selectedPlaylistId === null) return;
    const id = selectedPlaylistId;
    setPlaylistTracks(next);
    try {
      await replacePlaylistTracks(id, next);
    } catch (err) {
      console.error("Failed to save playlist order", err);
      showToast("Couldn't save the new order.");
      await loadTracksForPlaylist(id);
    }
  }

  async function handleRenamePlaylist(playlistId: number, name: string) {
    await renamePlaylist(playlistId, name);
    await refreshPlaylists();
  }

  async function handleDeletePlaylist(playlistId: number) {
    await deletePlaylistFromDb(playlistId);
    if (selectedPlaylistId === playlistId) {
      setView("search");
      setSelectedPlaylistId(null);
      setPlaylistTracks([]);
    }
    await refreshPlaylists();
  }

  async function handleImportPlaylist(url: string): Promise<string> {
    const result = await invoke<{ title: string; tracks: Track[] }>("import_playlist", { url });
    const id = await createPlaylist(result.title);
    const added = await addTracksToPlaylist(id, result.tracks);
    await refreshPlaylists();
    selectPlaylist(id);
    return `Imported "${result.title}" with ${added} track${added === 1 ? "" : "s"}.`;
  }

  // --- pages that load on open ---

  async function loadSuggestions() {
    setIsLoadingRecommendations(true);
    try {
      const [searches, played, recs] = await Promise.all([
        fetchSearchHistory(1),
        fetchRecentlyPlayed(1),
        buildRecommendations(),
      ]);
      setHasListeningHistory(searches.length > 0 || played.length > 0 || likedTracks.length > 0);
      setRecommendations(recs);
    } catch (err) {
      console.error("Failed to build suggestions", err);
    } finally {
      setIsLoadingRecommendations(false);
    }
  }

  async function loadStats() {
    setIsLoadingStats(true);
    try {
      setStats(computeStats(await fetchPlayLog()));
    } catch (err) {
      console.error("Failed to load stats", err);
    } finally {
      setIsLoadingStats(false);
    }
  }

  function handleViewChange(next: NavKey) {
    setView(next);
    if (next === "recent") {
      setIsLoadingRecent(true);
      fetchRecentlyPlayed()
        .then(setRecentlyPlayed)
        .catch((err) => console.error(err))
        .finally(() => setIsLoadingRecent(false));
    }
    if (next === "suggestions") loadSuggestions();
    if (next === "stats") loadStats();
  }

  function setLyricsOffset(trackId: string, offset: number) {
    setLyricsOffsets((prev) => {
      const next = { ...prev };
      if (offset === 0) delete next[trackId];
      else next[trackId] = offset;
      saveAppState("lyricsOffsets", next).catch((err) => console.warn("Failed to save lyrics timing", err));
      return next;
    });
  }

  // --- backup ---

  async function exportBackup(): Promise<string | null> {
    const backup = await buildBackup();
    const path = await invoke<string | null>("save_backup", {
      contents: JSON.stringify(backup, null, 2),
      suggestedName: backupFileName(),
    });
    if (!path) return null;
    return `Saved ${backup.playlists.length} playlists, ${backup.liked.length} liked songs and ${backup.plays.length.toLocaleString()} plays to ${path}`;
  }

  async function restoreFromBackup(): Promise<string | null> {
    const text = await invoke<string | null>("open_backup");
    if (text === null) return null;
    const summary = await restoreBackup(parseBackup(text));
    await reloadLibrary();
    return describeRestore(summary);
  }

  /** Re-read everything a restore can change. */
  async function reloadLibrary() {
    const [savedPlaylists, savedSettings, liked, offsets, recents] = await Promise.all([
      fetchPlaylists(),
      loadSettings(),
      fetchLikedTracks(),
      loadAppState<Record<string, number>>("lyricsOffsets"),
      fetchRecentSearches(),
    ]);
    setPlaylists(savedPlaylists);
    setSettings(savedSettings);
    setLikedTracks(liked);
    setLyricsOffsets(offsets ?? {});
    setRecentSearches(recents);
    if (selectedPlaylistId !== null) loadTracksForPlaylist(selectedPlaylistId);
  }

  // --- classic layout ---

  function openLibrary(next?: NavKey) {
    if (next) handleViewChange(next);
    setLibraryOpen(true);
  }

  function toggleLibrary() {
    if (libraryOpen) setLyricsOpen(false);
    setLibraryOpen(!libraryOpen);
  }

  function toggleLyricsClassic() {
    const next = !lyricsOpen;
    setLyricsOpen(next);
    if (next) setLibraryOpen(true);
  }

  async function saveQueueAsPlaylist(name: string) {
    const seen = new Set<string>();
    const tracks = [...(currentTrack ? [currentTrack] : []), ...queue].filter((t) => !seen.has(t.id) && !!seen.add(t.id));
    try {
      const id = await createPlaylist(name);
      await addTracksToPlaylist(id, tracks);
      await refreshPlaylists();
      showToast(`Saved ${tracks.length} track${tracks.length === 1 ? "" : "s"} to "${name}"`);
    } catch (err) {
      console.error("Failed to save playlist", err);
      showToast("Couldn't save that playlist.");
    }
  }

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next).catch((err) => console.warn("Failed to save settings", err));
  }

  // --- keep the once-attached listeners pointed at current logic ---
  latest.current = {
    togglePlay,
    seek,
    skipNext,
    skipPrevious,
    handleTrackEnded,
    maybeStartCrossfade,
    toggleLikeCurrent: () => {
      if (currentTrackRef.current) toggleLike(currentTrackRef.current);
    },
  };

  // --- keyboard shortcuts (window focused) ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const h = latest.current;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          h.togglePlay();
          break;
        case "ArrowRight":
          h.seek(Math.min(currentTimeRef.current + 5, currentTrackRef.current?.durationSeconds ?? currentTimeRef.current));
          break;
        case "ArrowLeft":
          h.seek(Math.max(currentTimeRef.current - 5, 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((v) => Math.min(1, +(v + 0.05).toFixed(2)));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => Math.max(0, +(v - 0.05).toFixed(2)));
          break;
        case "KeyN":
          h.skipNext();
          break;
        case "KeyP":
          h.skipPrevious();
          break;
        case "KeyL":
          h.toggleLikeCurrent();
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // --- system tray menu + global hotkeys (sent from Rust) ---
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<string>(PLAYER_ACTION_EVENT, (event) => {
      const h = latest.current;
      if (event.payload === "toggle") h.togglePlay();
      else if (event.payload === "next") h.skipNext();
      else if (event.payload === "previous") h.skipPrevious();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.warn("Couldn't listen for tray/hotkey actions", err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // --- OS media keys / lock screen ---
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (currentTrack) {
      const clean = cleanTrack(currentTrack);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: clean.title,
        artist: clean.artist,
        artwork: [{ src: currentTrack.thumbnail, sizes: "320x180", type: "image/jpeg" }],
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
    const h = () => latest.current;
    navigator.mediaSession.setActionHandler("play", () => h().togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => h().togglePlay());
    navigator.mediaSession.setActionHandler("nexttrack", () => h().skipNext());
    navigator.mediaSession.setActionHandler("previoustrack", () => h().skipPrevious());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
    };
  }, [currentTrack, isPlaying]);

  // --- Discord Rich Presence (with the cleaned-up title) ---
  useEffect(() => {
    if (currentTrack) {
      const clean = cleanTrack(currentTrack);
      updateDiscordPresence(
        { ...currentTrack, title: clean.title, uploader: clean.artist },
        isPlaying,
        currentTimeRef.current
      );
    } else {
      clearDiscordPresence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, isPlaying]);

  // --- lyrics ---
  useEffect(() => {
    if (!lyricsOpen || !currentTrack) {
      setLyrics(null);
      return;
    }
    const clean = cleanTrack(currentTrack);
    let cancelled = false;
    setIsLoadingLyrics(true);
    setLyrics(null);
    fetchLyrics(clean.lyricsTitle, clean.artist, currentTrack.durationSeconds)
      .then((result) => !cancelled && setLyrics(result))
      .finally(() => !cancelled && setIsLoadingLyrics(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsOpen, currentTrack?.id]);

  // --- context for every track row ---
  const trackActions: TrackActions = {
    playlists,
    likedIds,
    downloadedIds,
    downloadingIds,
    toggleLike,
    playNext,
    addToQueue,
    openArtist,
    download: downloadTrack,
    removeDownload,
    addToPlaylist: handleAddToPlaylist,
    createPlaylistWith: handleCreatePlaylistAndAdd,
  };

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) ?? null;
  const currentTrackId = currentTrack?.id ?? null;
  const downloadedTracks = downloads.map((d) => d.track);
  const visibleResults = settings.songsOnly ? results.filter(looksLikeSong) : results;
  const hiddenResultCount = results.length - visibleResults.length;

  const isClassic = settings.layout === "classic";
  // The classic layout has no queue or sound page (the playlist and EQ
  // windows do those jobs), so those views fall back to Search there.
  const pageView: View = isClassic && (view === "queue" || view === "sound") ? "search" : view;

  const pageContent = (
    <>
    {pageView === "search" && (
      <SearchView
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onSearch={handleSearch}
        results={visibleResults}
        hiddenCount={hiddenResultCount}
        hasSearched={hasSearched}
        isSearching={isSearching}
        canLoadMore={canLoadMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMoreResults}
        songsOnly={settings.songsOnly}
        onToggleSongsOnly={() => updateSettings({ ...settings, songsOnly: !settings.songsOnly })}
        recentSearches={recentSearches}
        onRemoveRecent={removeRecentSearch}
        onClearRecent={clearRecentSearches}
        error={searchError}
        ytdlp={ytdlp}
        onUpdateYtdlp={updateYtdlp}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        onPlay={(track) => playFromList(visibleResults, track)}
      />
    )}

    {pageView === "artist" && (
      <ArtistView
        data={artistPage}
        isLoading={isLoadingArtist}
        error={artistError}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        onPlay={(track, list) => playFromList(list, track)}
        onPlayAll={playAll}
      />
    )}

    {pageView === "suggestions" && (
      <SuggestionsView
        recommendations={recommendations}
        isLoading={isLoadingRecommendations}
        hasHistory={hasListeningHistory}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        onPlay={(track) => playFromList(recommendations.map((r) => r.track), track)}
        onRefresh={loadSuggestions}
      />
    )}

    {pageView === "queue" && (
      <QueueView
        queue={queue}
        currentTrackId={currentTrackId}
        onPlay={playFromQueue}
        onRemove={removeFromQueue}
        onReorder={setQueue}
        onClear={() => setQueue([])}
      />
    )}

    {pageView === "liked" && (
      <ListPage
        title="Liked Songs"
        description={likedTracks.length > 0 ? `${likedTracks.length} liked` : undefined}
        headerActions={
          <PillButton primary onClick={() => playAll(likedTracks)} disabled={likedTracks.length === 0}>
            Play all
          </PillButton>
        }
        isEmpty={likedTracks.length === 0}
        emptyText="Tap the heart on any track (or press L while something's playing) and it'll show up here."
      >
        {likedTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            isCurrent={track.id === currentTrackId}
            isPlaying={isPlaying}
            onPlay={() => playFromList(likedTracks, track)}
          />
        ))}
      </ListPage>
    )}

    {pageView === "downloads" && (
      <ListPage
        title="Downloads"
        description={
          downloads.length > 0
            ? "These play from your computer, so they work without an internet connection."
            : undefined
        }
        headerActions={
          <PillButton primary onClick={() => playAll(downloadedTracks)} disabled={downloads.length === 0}>
            Play all
          </PillButton>
        }
        isEmpty={downloads.length === 0 && downloadingIds.size === 0}
        emptyText="Nothing downloaded yet. Use “Download for offline” in any track's ⋯ menu."
      >
        {downloadedTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            isCurrent={track.id === currentTrackId}
            isPlaying={isPlaying}
            onPlay={() => playFromList(downloadedTracks, track)}
          />
        ))}
      </ListPage>
    )}

    {pageView === "recent" && (
      <ListPage
        title="Recently Played"
        isLoading={isLoadingRecent}
        isEmpty={recentlyPlayed.length === 0}
        emptyText="Nothing played yet."
      >
        {recentlyPlayed.map((track, i) => (
          <TrackRow
            key={`${track.id}-${i}`}
            track={track}
            isCurrent={track.id === currentTrackId}
            isPlaying={isPlaying}
            onPlay={() => playFromList(recentlyPlayed, track)}
          />
        ))}
      </ListPage>
    )}

    {pageView === "stats" && (
      <StatsView
        stats={stats}
        isLoading={isLoadingStats}
        likedCount={likedTracks.length}
        currentTrackId={currentTrackId}
        onPlay={(track, list) => playFromList(list, track)}
      />
    )}

    {pageView === "playlist" && (
      <PlaylistView
        playlist={selectedPlaylist}
        tracks={playlistTracks}
        isLoading={isLoadingPlaylistTracks}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        onPlay={(track) => playFromList(playlistTracks, track)}
        onPlayAll={playAll}
        onRemove={handleRemoveFromPlaylist}
        onReorder={handleReorderPlaylist}
        onRename={handleRenamePlaylist}
        onDeletePlaylist={handleDeletePlaylist}
      />
    )}

    {pageView === "sound" && !isClassic && (
      <SoundView
        analyser={graphAvailable ? graphRef.current?.analyser ?? null : null}
        isPlaying={isPlaying}
        trackTitle={currentTrack ? cleanTrack(currentTrack).title : null}
        settings={settings}
        onChange={updateSettings}
      />
    )}

    {pageView === "settings" && (
      <SettingsView
        settings={settings}
        onChange={updateSettings}
        onShowWelcome={handleShowWelcomeAgain}
        ytdlp={ytdlp}
        onLoadYtdlpVersion={loadYtdlpVersion}
        onUpdateYtdlp={updateYtdlp}
        onExportBackup={exportBackup}
        onRestoreBackup={restoreFromBackup}
        appVersion={appVersion}
        onCheckAppUpdate={() => checkForAppUpdate(true)}
        onShowChangelog={() => setChangelogView({ title: "What's new in Playnest", entries: CHANGELOG })}
      />
    )}

    </>
  );

  const lyricsPanel = lyricsOpen && (
      <LyricsPanel
        lyrics={lyrics}
        isLoading={isLoadingLyrics}
        currentTime={currentTime}
        trackTitle={currentTrack ? cleanTrack(currentTrack).title : null}
        trackDuration={currentTrack?.durationSeconds ?? 0}
        offset={currentTrack ? lyricsOffsets[currentTrack.id] ?? 0 : 0}
        onOffsetChange={(offset) => currentTrack && setLyricsOffset(currentTrack.id, offset)}
        onSeek={seek}
        onClose={() => setLyricsOpen(false)}
      />
    );

  if (!onboardingChecked) {
    return (
      <div className="h-screen bg-ink-900 flex items-center justify-center">
        <p className="text-sm text-mist-500">Loading…</p>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="h-screen bg-ink-900 text-mist-100 flex items-center justify-center px-8">
        <div className="max-w-lg">
          <h1 className="font-display text-xl font-semibold">Couldn't open your local library</h1>
          <p className="text-sm text-mist-500 mt-2">
            Playnest couldn't load its database, so playlists and history aren't available. The
            underlying error was:
          </p>
          <pre className="mt-4 text-xs text-ember-soft bg-ink-800 border border-ink-700 rounded-lg p-3 whitespace-pre-wrap break-words">
            {dbError}
          </pre>
        </div>
      </div>
    );
  }

  if (showWelcome) {
    return <WelcomePage onGetStarted={handleGetStarted} />;
  }

  if (!settingsLoaded) {
    return <div className="h-screen bg-ink-900" />;
  }

  if (showEngineSetup) {
    return <EngineSetup engine={engine} onRetry={installEngine} onSkip={() => setEngineSkipped(true)} />;
  }

  const toastView = toast && (
    <div
      role="status"
      className={
        isClassic
          ? "cw-toast"
          : "fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-md bg-ink-700 border border-ink-600 text-sm text-mist-100 rounded-full px-4 py-2 shadow-xl"
      }
    >
      {toast}
    </div>
  );

  const importDialog = (
    <>
      {importOpen && <ImportPlaylistDialog onClose={() => setImportOpen(false)} onImport={handleImportPlaylist} />}
      {appUpdate && (
        <UpdateDialog
          currentVersion={appUpdate.currentVersion}
          version={appUpdate.version}
          date={appUpdate.date ?? null}
          notes={appUpdate.body ?? ""}
          onInstall={(onProgress) => installAppUpdate(appUpdate, onProgress)}
          onLater={() => setAppUpdate(null)}
          onSkip={() => {
            saveAppState("skippedUpdate", appUpdate.version).catch(() => {});
            setAppUpdate(null);
          }}
        />
      )}
      {changelogView && (
        <ChangelogDialog
          title={changelogView.title}
          entries={changelogView.entries}
          onClose={() => setChangelogView(null)}
        />
      )}
    </>
  );

  if (isClassic) {
    const classicPlayer: ClassicPlayer = {
      track: currentTrack,
      isPlaying,
      isLoading: isLoadingStream,
      currentTime,
      volume,
      shuffle,
      repeatMode,
      liked: currentTrack ? likedIds.has(currentTrack.id) : false,
      isOffline: currentTrack ? downloadedIds.has(currentTrack.id) : false,
      sleepTimer,
      lyricsOpen,
      queue,
      likedTracks,
      downloadedTracks,
      analyser: graphAvailable ? graphRef.current?.analyser ?? null : null,
      effectsAvailable: graphAvailable,
      settings,
      onSettingsChange: updateSettings,
      onPlay: classicPlay,
      onPause: togglePlay,
      onStop: stop,
      onNext: () => skipNext(),
      onPrevious: skipPrevious,
      onSeek: seek,
      onVolumeChange: setVolume,
      onToggleShuffle: () => setShuffle((v) => !v),
      onCycleRepeat: () => setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off")),
      onToggleLike: () => currentTrack && toggleLike(currentTrack),
      onToggleLyrics: toggleLyricsClassic,
      onSetSleepTimer: handleSetSleepTimer,
      onPlayFromQueue: playFromQueue,
      onQueueChange: setQueue,
      onSaveQueueAsPlaylist: saveQueueAsPlaylist,
      onImportPlaylist: () => setImportOpen(true),
      onOpenArtist: (name) => {
        openArtist(name);
        setLibraryOpen(true);
      },
    };

    return (
      <TrackActionsContext.Provider value={trackActions}>
        <ClassicLayout
          player={classicPlayer}
          libraryOpen={libraryOpen}
          onToggleLibrary={toggleLibrary}
          onFindMusic={() => openLibrary("search")}
          library={
            <LibraryPanel
              view={pageView}
              onViewChange={handleViewChange}
              playlists={playlists}
              selectedPlaylistId={selectedPlaylistId}
              onSelectPlaylist={selectPlaylist}
              onCreatePlaylist={handleCreatePlaylist}
              onImportPlaylist={() => setImportOpen(true)}
              onClose={toggleLibrary}
              side={lyricsPanel}
            >
              {pageContent}
            </LibraryPanel>
          }
        />
        {toastView}
        {importDialog}
      </TrackActionsContext.Provider>
    );
  }

  return (
    <TrackActionsContext.Provider value={trackActions}>
      <div className="h-screen flex flex-col bg-ink-900 text-mist-100">
        <div className="flex-1 flex min-h-0">
          <Sidebar
            view={view}
            onViewChange={handleViewChange}
            queueCount={queue.length}
            playlists={playlists}
            selectedPlaylistId={selectedPlaylistId}
            onSelectPlaylist={selectPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            onImportPlaylist={() => setImportOpen(true)}
          />

          {pageContent}
          {lyricsPanel}
        </div>

        <NowPlayingBar
          track={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          volume={volume}
          isLoading={isLoadingStream}
          shuffle={shuffle}
          repeatMode={repeatMode}
          lyricsOpen={lyricsOpen}
          liked={currentTrack ? likedIds.has(currentTrack.id) : false}
          sleepTimer={sleepTimer}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={setVolume}
          onSkipNext={() => skipNext()}
          onSkipPrevious={skipPrevious}
          onToggleShuffle={() => setShuffle((v) => !v)}
          onCycleRepeat={() => setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"))}
          onToggleLyrics={() => setLyricsOpen((v) => !v)}
          onToggleLike={() => currentTrack && toggleLike(currentTrack)}
          onSetSleepTimer={handleSetSleepTimer}
          onOpenArtist={openArtist}
        />

        {toastView}
        {importDialog}
      </div>
    </TrackActionsContext.Provider>
  );
}
