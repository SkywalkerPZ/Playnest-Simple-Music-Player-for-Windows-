import { ReactNode, useEffect, useRef, useState } from "react";
import EqualizerWindow from "./EqualizerWindow";
import MainWindow from "./MainWindow";
import PlaylistWindow from "./PlaylistWindow";
import { ClassicPlayer } from "./types";
import {
  closeWindow,
  getWindowSize,
  minimizeWindow,
  setWindowDecorations,
  setWindowMinSize,
  setWindowSize,
} from "./windowControls";

interface ClassicLayoutProps {
  player: ClassicPlayer;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  /** Open the library on Search. */
  onFindMusic: () => void;
  /** The library panel, shown beside the player when open. */
  library: ReactNode;
}

/** Width of the player stack, and of the whole window when the library is closed. */
const STACK_WIDTH = 480;
const WITH_LIBRARY_WIDTH = 1240;
const MIN_WITH_LIBRARY = { width: 1000, height: 600 };
const MIN_STACK = { width: 420, height: 420 };
const DEFAULT_HEIGHT = 820;

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Only a convenience; ignore.
  }
}

/** Main player, equalizer and playlist stacked in a narrow frameless
 * window; the library opens to the right and widens the window. */
export default function ClassicLayout({ player, libraryOpen, onToggleLibrary, onFindMusic, library }: ClassicLayoutProps) {
  const [eqOpen, setEqOpen] = useState(() => loadFlag("playnest.classic.eq", true));
  const [plOpen, setPlOpen] = useState(() => loadFlag("playnest.classic.pl", true));
  const mainRef = useRef<HTMLDivElement>(null);
  const eqRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  /** Window height before it was shrunk to fit a hidden playlist. */
  const tallHeightRef = useRef<number | null>(null);

  useEffect(() => saveFlag("playnest.classic.eq", eqOpen), [eqOpen]);
  useEffect(() => saveFlag("playnest.classic.pl", plOpen), [plOpen]);

  // Fit the native window to what's showing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await setWindowDecorations(false);
      const size = await getWindowSize();
      if (!size || cancelled) return;

      // Bottom of the last visible panel, plus the stack's own padding.
      const last = (eqOpen ? eqRef.current : null) ?? mainRef.current;
      const stack = stackRef.current;
      const stackHeight =
        last && stack
          ? Math.ceil(last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(stack).paddingBottom || "0"))
          : 180;
      let width: number;
      let height: number;
      let min: { width: number; height: number };

      if (libraryOpen) {
        width = Math.max(size.width, WITH_LIBRARY_WIDTH);
        height = Math.max(size.height, tallHeightRef.current ?? 0, 700);
        min = MIN_WITH_LIBRARY;
      } else if (!plOpen) {
        if (size.height > stackHeight + 40) tallHeightRef.current = size.height;
        width = STACK_WIDTH;
        height = stackHeight;
        min = { width: MIN_STACK.width, height: stackHeight };
      } else {
        width = STACK_WIDTH;
        height = size.height < 500 ? tallHeightRef.current ?? DEFAULT_HEIGHT : size.height;
        min = MIN_STACK;
      }
      if (libraryOpen || plOpen) tallHeightRef.current = null;

      // Lower the minimum first, or shrinking would be refused.
      await setWindowMinSize(Math.min(min.width, width), Math.min(min.height, height));
      if (cancelled) return;
      if (width !== size.width || height !== size.height) await setWindowSize(width, height);
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryOpen, plOpen, eqOpen]);

  return (
    <div className="cw-root">
      <div ref={stackRef} className="cw-stack" style={libraryOpen ? undefined : { width: "100%", flexShrink: 1 }}>
        <div ref={mainRef}>
          <MainWindow
            player={player}
            eqOpen={eqOpen}
            plOpen={plOpen}
            libraryOpen={libraryOpen}
            onToggleEq={() => setEqOpen((v) => !v)}
            onTogglePl={() => setPlOpen((v) => !v)}
            onToggleLibrary={onToggleLibrary}
            onEject={onFindMusic}
            onMinimize={() => minimizeWindow()}
            onClose={() => closeWindow()}
          />
        </div>
        {eqOpen && (
          <div ref={eqRef}>
            <EqualizerWindow
              settings={player.settings}
              onChange={player.onSettingsChange}
              effectsAvailable={player.effectsAvailable}
              onClose={() => setEqOpen(false)}
            />
          </div>
        )}
        {plOpen && <PlaylistWindow player={player} onClose={() => setPlOpen(false)} onFindMusic={onFindMusic} />}
      </div>
      {libraryOpen && library}
    </div>
  );
}
