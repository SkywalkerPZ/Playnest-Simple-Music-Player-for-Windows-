import { CSSProperties, useEffect, useState } from "react";
import SleepTimerMenu from "../components/SleepTimerMenu";
import { formatDuration } from "../lib/format";
import { cleanTrack } from "../lib/titles";
import { Icons, Marquee, MiniSpectrum, NestMark, SevenSegment, TitleBar } from "./parts";
import { ClassicPlayer } from "./types";

interface MainWindowProps {
  player: ClassicPlayer;
  eqOpen: boolean;
  plOpen: boolean;
  libraryOpen: boolean;
  onToggleEq: () => void;
  onTogglePl: () => void;
  onToggleLibrary: () => void;
  /** ⏏: open the library on Search. */
  onEject: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "mm:ss" for the big LCD, with a leading "-" for time remaining. */
function lcdTime(seconds: number, remaining: boolean): string {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.min(99, Math.floor(s / 60));
  return `${remaining ? "-" : " "}${pad2(minutes)}:${pad2(s % 60)}`;
}

export default function MainWindow({
  player,
  eqOpen,
  plOpen,
  libraryOpen,
  onToggleEq,
  onTogglePl,
  onToggleLibrary,
  onEject,
  onMinimize,
  onClose,
}: MainWindowProps) {
  const { track, isPlaying, isLoading, currentTime, settings } = player;
  const [showRemaining, setShowRemaining] = useState(false);
  // While dragging the seek bar, show the drag position instead of playback.
  const [scrub, setScrub] = useState<number | null>(null);

  const duration = track?.durationSeconds ?? 0;
  const canSeek = !!track && duration > 0;
  const shownTime = scrub ?? currentTime;
  const stopped = !!track && !isPlaying && !isLoading && currentTime < 0.5;
  const paused = !!track && !isPlaying && !isLoading && !stopped;

  useEffect(() => setScrub(null), [track?.id]);

  const clean = track ? cleanTrack(track) : null;
  const marqueeText = clean
    ? `${isLoading ? "Buffering: " : ""}1. ${clean.artist ? `${clean.artist} - ` : ""}${clean.title} (${formatDuration(duration)})`
    : "PLAYNEST  ***  Press ⏏ or ADD to find some music";

  const timeText = track
    ? lcdTime(showRemaining && duration > 0 ? duration - shownTime : shownTime, showRemaining && duration > 0)
    : " 00:00";

  function commitScrub() {
    if (scrub !== null) player.onSeek(scrub);
    setScrub(null);
  }

  const status = isLoading ? "loading" : isPlaying ? "playing" : paused ? "paused" : "stopped";
  const statusIcon = status === "playing" ? Icons.play : status === "paused" ? Icons.pause : status === "stopped" ? Icons.stop : null;

  const volumeStyle = { "--fill": `${Math.round(player.volume * 100)}%` } as CSSProperties;
  const seekStyle = { "--fill": `${canSeek ? Math.min(100, (shownTime / duration) * 100) : 0}%` } as CSSProperties;

  const repeatLabel = player.repeatMode === "one" ? "REP 1" : "REP";

  return (
    <section className="cw-window" aria-label="Player">
      <TitleBar title="PLAYNEST" onMinimize={onMinimize} onClose={onClose} closeLabel="Close Playnest" />

      <div className="flex gap-[5px]">
        {/* Time + visualizer */}
        <div className="cw-lcd w-[150px] h-[64px] shrink-0 flex flex-col justify-between px-[5px] pt-[5px] pb-[4px]">
          <div className="flex items-start gap-[6px]">
            <span
              className={`w-[12px] h-[12px] flex items-center justify-center ${status === "loading" ? "cw-blink" : ""}`}
              style={{ color: "var(--cw-lcd-fg)" }}
              aria-label={status}
              role="img"
            >
              {statusIcon ?? (
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                  <rect width="8" height="8" fill="currentColor" />
                </svg>
              )}
            </span>
            <button
              onClick={() => setShowRemaining((v) => !v)}
              className="ml-auto"
              title={showRemaining ? "Showing time remaining (click for elapsed)" : "Showing elapsed time (click for remaining)"}
              aria-label={`${showRemaining ? "Remaining" : "Elapsed"} time ${timeText.trim()}. Click to switch.`}
            >
              <SevenSegment text={timeText} blink={paused} />
            </button>
          </div>
          <MiniSpectrum
            analyser={player.analyser}
            active={isPlaying && player.effectsAvailable}
            skin={settings.skin}
            width={76}
            height={16}
          />
        </div>

        {/* Title, info and volume */}
        <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
          <div className="cw-lcd h-[20px] px-[5px] flex items-center">
            <Marquee text={marqueeText} className="cw-lcd-text w-full" />
          </div>

          <div className="cw-lcd h-[17px] px-[3px] flex items-center gap-[2px]" aria-label="Status">
            <span className="cw-tag" data-on={!!track && !player.isOffline} title="Streaming from the web">
              WEB
            </span>
            <span className="cw-tag" data-on={!!track && player.isOffline} title="Playing a download">
              DISK
            </span>
            <span className="cw-tag" data-on={!!track}>
              STEREO
            </span>
            <span className="ml-auto flex items-center gap-[2px]">
              <span className="cw-tag" data-on={settings.eqEnabled && player.effectsAvailable} title="Equalizer">
                EQ
              </span>
              <span className="cw-tag" data-on={settings.levelling && player.effectsAvailable} title="Volume levelling">
                LVL
              </span>
              <span className="cw-tag" data-on={settings.crossfadeSeconds > 0} title="Crossfade">
                XF
              </span>
              <span className="cw-tag" data-on={player.sleepTimer !== null} title="Sleep timer">
                ZZ
              </span>
            </span>
          </div>

          <div className="flex items-center gap-[4px] mt-auto">
            <span className="cw-label">VOL</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={player.volume}
              onChange={(e) => player.onVolumeChange(Number(e.target.value))}
              onWheel={(e) => player.onVolumeChange(Math.max(0, Math.min(1, +(player.volume - Math.sign(e.deltaY) * 0.05).toFixed(2))))}
              aria-label="Volume"
              title={`Volume ${Math.round(player.volume * 100)}%`}
              className="cw-range flex-1 min-w-0 max-w-[220px] mr-auto"
              style={volumeStyle}
            />
            <button className="cw-btn cw-toggle" aria-pressed={eqOpen} onClick={onToggleEq} title="Show or hide the equalizer">
              EQ
            </button>
            <button className="cw-btn cw-toggle" aria-pressed={plOpen} onClick={onTogglePl} title="Show or hide the playlist">
              PL
            </button>
            <button
              className="cw-btn cw-toggle"
              aria-pressed={libraryOpen}
              onClick={onToggleLibrary}
              title="Show or hide the library (search, playlists, liked songs…)"
            >
              LIB
            </button>
          </div>
        </div>
      </div>

      <div className="mt-[6px]">
        <input
          type="range"
          min={0}
          max={canSeek ? duration : 1}
          step={0.5}
          value={canSeek ? Math.min(shownTime, duration) : 0}
          disabled={!canSeek}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
          aria-label="Seek"
          aria-valuetext={`${formatDuration(shownTime)} of ${formatDuration(duration)}`}
          className="cw-range cw-seek"
          style={seekStyle}
        />
      </div>

      <div className="mt-[6px] flex items-center gap-[3px]">
        <button className="cw-btn cw-transport" onClick={player.onPrevious} aria-label="Previous" title="Previous">
          {Icons.previous}
        </button>
        <button
          className="cw-btn cw-transport"
          onClick={player.onPlay}
          aria-label="Play"
          title="Play (restarts the track if it's already playing)"
        >
          {Icons.play}
        </button>
        <button
          className="cw-btn cw-transport"
          onClick={player.onPause}
          aria-label="Pause"
          aria-pressed={paused}
          data-down={paused}
          title="Pause"
          disabled={!track}
        >
          {Icons.pause}
        </button>
        <button className="cw-btn cw-transport" onClick={player.onStop} aria-label="Stop" title="Stop" disabled={!track}>
          {Icons.stop}
        </button>
        <button className="cw-btn cw-transport" onClick={player.onNext} aria-label="Next" title="Next">
          {Icons.next}
        </button>
        <button className="cw-btn cw-transport ml-[3px]" onClick={onEject} aria-label="Find music" title="Find music (opens Search)">
          {Icons.eject}
        </button>

        <span className="ml-[6px] flex items-center gap-[3px]">
          <button className="cw-btn cw-toggle" aria-pressed={player.shuffle} onClick={player.onToggleShuffle} title="Shuffle">
            SHUF
          </button>
          <button
            className="cw-btn cw-toggle"
            aria-pressed={player.repeatMode !== "off"}
            onClick={player.onCycleRepeat}
            title={`Repeat: ${player.repeatMode}`}
            aria-label={`Repeat: ${player.repeatMode}`}
          >
            {repeatLabel}
          </button>
        </span>

        <span className="ml-auto flex items-center gap-[3px]">
          <button
            className="cw-btn cw-toggle"
            aria-pressed={player.liked}
            onClick={player.onToggleLike}
            disabled={!track}
            aria-label={player.liked ? "Unlike" : "Like"}
            title={player.liked ? "Remove from Liked Songs (L)" : "Add to Liked Songs (L)"}
          >
            <svg width="9" height="8" viewBox="0 0 9 8" fill="currentColor" aria-hidden="true" shapeRendering="crispEdges">
              <path d="M1 0h2v1h1v1h1V1h1V0h2v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z" />
            </svg>
          </button>
          <button
            className="cw-btn cw-toggle"
            aria-pressed={player.lyricsOpen}
            onClick={player.onToggleLyrics}
            disabled={!track}
            title="Lyrics"
          >
            LYR
          </button>
          <SleepTimerMenu timer={player.sleepTimer} onSet={player.onSetSleepTimer} classic />
          <NestMark size={16} className="ml-[3px] text-[color:var(--cw-title-text)] opacity-90" />
        </span>
      </div>
    </section>
  );
}
