import {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/* ---------- logo ---------- */

/** Playnest's mark (three bars and a play arrow in a disc, as in the app
 * icon), drawn in the skin's colours. */
export function NestMark({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="13.5" fill="var(--cw-logo-bg, currentColor)" />
      <g fill="var(--cw-logo-fg, var(--cw-lo))">
        <rect x="8.3" y="11.1" width="1.45" height="5.8" rx="0.7" />
        <rect x="10.85" y="8.25" width="1.45" height="11.5" rx="0.7" />
        <rect x="13.4" y="5.4" width="1.45" height="17.2" rx="0.7" />
        <path d="M16.85 9.7 22.6 14l-5.75 4.3z" />
      </g>
      <ellipse cx="14" cy="8" rx="10" ry="5.5" fill="var(--cw-logo-gloss, transparent)" />
    </svg>
  );
}

/* ---------- title bar ---------- */

interface TitleBarProps {
  title: string;
  onClose?: () => void;
  closeLabel?: string;
  onMinimize?: () => void;
}

/** Striped title bar. Dragging it moves the (frameless) app window. */
export function TitleBar({ title, onClose, closeLabel = "Close", onMinimize }: TitleBarProps) {
  return (
    <div className="cw-titlebar" data-tauri-drag-region>
      <NestMark size={11} className="cw-titlebar-logo" />
      <span className="cw-titlebar-groove" data-tauri-drag-region />
      <span className="cw-titlebar-text">{title}</span>
      <span className="cw-titlebar-groove" data-tauri-drag-region />
      {onMinimize && (
        <button className="cw-titlebar-btn" onClick={onMinimize} aria-label="Minimize" title="Minimize">
          <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true">
            <rect x="1" y="5" width="5" height="1.5" fill="currentColor" />
          </svg>
        </button>
      )}
      {onClose && (
        <button className="cw-titlebar-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
          <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true">
            <path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ---------- seven-segment time ---------- */

const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  " ": "",
};

// Segment rectangles in a 10 x 18 digit cell.
const SEGMENT_RECTS: Record<string, [number, number, number, number]> = {
  a: [2, 0, 6, 2],
  b: [8, 2, 2, 6],
  c: [8, 10, 2, 6],
  d: [2, 16, 6, 2],
  e: [0, 10, 2, 6],
  f: [0, 2, 2, 6],
  g: [2, 8, 6, 2],
};

/** Big LCD digits, e.g. "-03:45". Unlit segments show faintly, like a real LCD. */
export function SevenSegment({ text, scale = 1.25, blink = false }: { text: string; scale?: number; blink?: boolean }) {
  const cells: ReactNode[] = [];
  let x = 0;
  for (const [i, ch] of [...text].entries()) {
    if (ch === ":") {
      cells.push(
        <g key={i} fill="var(--cw-lcd-fg)">
          <rect x={x + 1} y={4} width={2} height={2} />
          <rect x={x + 1} y={12} width={2} height={2} />
        </g>
      );
      x += 5;
      continue;
    }
    const lit = SEGMENTS[ch] ?? "";
    cells.push(
      <g key={i}>
        {Object.entries(SEGMENT_RECTS).map(([seg, [sx, sy, w, h]]) => (
          <rect
            key={seg}
            x={x + sx}
            y={sy}
            width={w}
            height={h}
            fill={lit.includes(seg) ? "var(--cw-lcd-fg)" : ch === "-" || ch === " " ? "transparent" : "var(--cw-lcd-dim)"}
          />
        ))}
      </g>
    );
    x += 13;
  }
  const width = x - 3;
  return (
    <svg
      width={width * scale}
      height={18 * scale}
      viewBox={`0 0 ${width} 18`}
      className={blink ? "cw-blink" : undefined}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {cells}
    </svg>
  );
}

/* ---------- scrolling title ---------- */

/** Scrolls its text when it doesn't fit, like a classic player's song title. */
export function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const span = textRef.current;
    if (!box || !span) return;
    const measure = () => setDistance(span.scrollWidth > box.clientWidth ? span.scrollWidth : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const gap = "  ***  ";
  const style: CSSProperties | undefined = distance
    ? ({
        "--cw-marquee-distance": `${distance}px`,
        animationDuration: `${Math.max(6, distance / 28)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <div ref={boxRef} className={`overflow-hidden whitespace-nowrap ${className}`} title={text}>
      <div className={distance ? "cw-marquee-track inline-block" : "inline-block"} style={style}>
        <span ref={textRef}>
          {text}
          {distance ? gap : ""}
        </span>
        {distance ? (
          <span aria-hidden="true">
            {text}
            {gap}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- mini spectrum analyser ---------- */

const BAR_COUNT = 19;
const ROWS = 16;

/** Bar spectrum drawn from the audio graph's analyser. Bars fall back to
 * zero and the loop stops when playback pauses. */
export function MiniSpectrum({
  analyser,
  active,
  skin,
  width = 76,
  height = 16,
}: {
  analyser: AnalyserNode | null;
  active: boolean;
  skin: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const peaks = useRef<number[]>(new Array(BAR_COUNT).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(canvas);
    const green = css.getPropertyValue("--cw-lcd-fg").trim() || "#3f3";
    const dim = css.getPropertyValue("--cw-lcd-dim").trim() || "#132";
    const cssVar = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const top = cssVar("--cw-vis-top", "#ff4a1c");
    const mid = cssVar("--cw-vis-mid", "#e8e030");
    const peak = cssVar("--cw-vis-peak", "#c8c8c8");
    const rowColor = (row: number) => (row >= ROWS - 3 ? top : row >= ROWS - 7 ? mid : green);

    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    // Log-spaced band edges from ~40 Hz to ~16 kHz.
    const nyquist = analyser ? analyser.context.sampleRate / 2 : 24000;
    const edges = Array.from({ length: BAR_COUNT + 1 }, (_, i) => 40 * Math.pow(16000 / 40, i / BAR_COUNT));
    const binFor = (hz: number) => (bins ? Math.min(bins.length - 1, Math.round((hz / nyquist) * bins.length)) : 0);

    const barW = 3;
    const gap = 1;
    let raf = 0;
    let lastFrame = 0;
    // ~30 fps looks the same at this size and halves the redraw cost.
    const FRAME_MS = 1000 / 30;

    const draw = (now: number) => {
      if (document.hidden) {
        raf = 0; // resumed by the visibilitychange listener
        return;
      }
      if (now - lastFrame < FRAME_MS) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;
      if (analyser && bins && active) analyser.getByteFrequencyData(bins);
      ctx.clearRect(0, 0, width, height);
      let moving = false;
      for (let b = 0; b < BAR_COUNT; b++) {
        let target = 0;
        if (analyser && bins && active) {
          const lo = binFor(edges[b]);
          const hi = Math.max(lo, binFor(edges[b + 1]));
          let max = 0;
          for (let i = lo; i <= hi; i++) max = Math.max(max, bins[i]);
          target = Math.round((max / 255) * ROWS);
        }
        const level = target >= levels.current[b] ? target : Math.max(target, levels.current[b] - 1);
        levels.current[b] = level;
        if (level >= peaks.current[b]) peaks.current[b] = level;
        else peaks.current[b] = Math.max(0, peaks.current[b] - 0.25);
        if (level > 0 || peaks.current[b] > 0) moving = true;

        const x = b * (barW + gap);
        for (let row = 0; row < ROWS; row++) {
          const y = height - (row + 1) * (height / ROWS);
          if (row < level) {
            ctx.fillStyle = rowColor(row);
            ctx.fillRect(x, y, barW, height / ROWS);
          }
        }
        const peakRow = Math.floor(peaks.current[b]);
        if (peakRow > 0) {
          ctx.fillStyle = peak;
          ctx.fillRect(x, height - (peakRow + 1) * (height / ROWS), barW, 1);
        }
      }
      // Faint baseline so the area reads as a display even when idle.
      ctx.fillStyle = dim;
      ctx.fillRect(0, height - 1, width, 1);
      raf = active || moving ? requestAnimationFrame(draw) : 0;
    };
    const resume = () => {
      if (!document.hidden && raf === 0) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", resume);
    draw(performance.now());
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [analyser, active, skin, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} aria-hidden="true" style={{ width, height }} />;
}

/* ---------- popup menu ---------- */

/** A small skinned menu; closes on outside click or Escape. */
export function PopupMenu({
  open,
  onClose,
  className = "",
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer so the click that opened the menu doesn't close it.
    const id = window.setTimeout(() => window.addEventListener("pointerdown", onPointer), 0);
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={ref} role="menu" aria-label={label} className={`cw-menu ${className}`} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/* ---------- vertical slider (EQ bands) ---------- */

interface VSliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
  /** Double-click resets to this value. */
  resetTo?: number;
}

export function VSlider({ value, min, max, onChange, label, disabled = false, resetTo = 0 }: VSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const frac = (value - min) / (max - min); // 0 at the bottom
  const zeroFrac = (0 - min) / (max - min);

  function valueAt(clientY: number) {
    const rect = ref.current!.getBoundingClientRect();
    const t = 1 - (clientY - rect.top) / rect.height;
    return clamp(min + t * (max - min));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    onChange(valueAt(e.clientY));
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const next = valueAt(e.clientY);
    if (next !== value) onChange(next);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const steps: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 3, PageDown: -3 };
    let next: number | null = null;
    if (e.key in steps) next = clamp(value + steps[e.key]);
    else if (e.key === "Home") next = max;
    else if (e.key === "End") next = min;
    else if (e.key === "0" || e.key === "Delete") next = resetTo;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // arrows shouldn't also seek / change volume
    if (next !== value) onChange(next);
  }

  const top = Math.min(frac, zeroFrac);
  const bottom = Math.max(frac, zeroFrac);
  const hot = Math.abs(value) / Math.max(Math.abs(min), Math.abs(max));
  const fillColor =
    hot > 0.7 ? "var(--cw-vis-top, #ff5a24)" : hot > 0.4 ? "var(--cw-vis-mid, #e8e030)" : "var(--cw-lcd-fg)";

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value > 0 ? "+" : ""}${value} dB`}
      aria-orientation="vertical"
      aria-disabled={disabled}
      title={`${label}: ${value > 0 ? "+" : ""}${value} dB`}
      className="cw-vslider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      onDoubleClick={() => !disabled && onChange(resetTo)}
    >
      <div className="cw-vslider-track" />
      <div
        className="cw-vslider-fill"
        style={{ top: `${(1 - bottom) * 100}%`, bottom: `${top * 100}%`, background: fillColor }}
      />
      <div className="cw-vslider-thumb" style={{ top: `${(1 - frac) * 100}%` }} />
    </div>
  );
}

/* ---------- transport icons ---------- */

const icon = (children: ReactNode, w = 12) => (
  <svg width={w} height="10" viewBox={`0 0 ${w} 10`} fill="currentColor" aria-hidden="true" shapeRendering="crispEdges">
    {children}
  </svg>
);

export const Icons = {
  previous: icon(
    <>
      <rect x="0" y="0" width="2" height="10" />
      <path d="M7 0v10L2 5zM12 0v10L7 5z" />
    </>
  ),
  play: icon(<path d="M3 0v10l8-5z" />),
  pause: icon(
    <>
      <rect x="2" y="0" width="3" height="10" />
      <rect x="7" y="0" width="3" height="10" />
    </>
  ),
  stop: icon(<rect x="1.5" y="0.5" width="9" height="9" />),
  next: icon(
    <>
      <path d="M0 0v10l5-5zM5 0v10l5-5z" />
      <rect x="10" y="0" width="2" height="10" />
    </>
  ),
  eject: icon(
    <>
      <path d="M6 0l6 6H0z" />
      <rect x="0" y="8" width="12" height="2" />
    </>
  ),
};
