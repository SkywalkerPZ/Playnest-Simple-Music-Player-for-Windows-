import { useEffect, useRef } from "react";
import { EQ_FREQUENCIES, EQ_MAX_DB, EQ_PRESETS } from "../lib/audioGraph";
import { Settings } from "../lib/settings";

interface SoundViewProps {
  /** Null when audio effects are unavailable (relay didn't start). */
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  trackTitle: string | null;
  settings: Settings;
  onChange: (next: Settings) => void;
}

const BAR_COUNT = 48;
const MIN_HZ = 30;
const MAX_HZ = 16000;

function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** Frequency bars on a log scale (like hearing), so bass isn't squeezed into
 * the first couple of bars. One hue: it shows magnitude, not categories. */
function Visualizer({ analyser, isPlaying }: { analyser: AnalyserNode; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const edges = Array.from({ length: BAR_COUNT + 1 }, (_, i) =>
      Math.max(1, Math.round((MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / BAR_COUNT)) / binHz))
    );
    let frame = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      frame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const slot = width / BAR_COUNT;
      const gap = Math.max(2, slot * 0.18);
      const barWidth = Math.min(24 * (window.devicePixelRatio || 1), slot - gap);
      const radius = Math.min(4, barWidth / 2);
      ctx.fillStyle = "#ff6f3c";

      for (let i = 0; i < BAR_COUNT; i++) {
        const from = edges[i];
        const to = Math.max(from + 1, edges[i + 1]);
        let peak = 0;
        for (let b = from; b < to && b < data.length; b++) peak = Math.max(peak, data[b]);
        const barHeight = Math.max(2, (peak / 255) * (height - 4));
        const x = i * slot + (slot - barWidth) / 2;
        const y = height - barHeight;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
        ctx.fill();
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [analyser]);

  return (
    <div className="relative h-44">
      <canvas ref={canvasRef} className="w-full h-full block" aria-label="Live audio frequency visualizer" role="img" />
      {!isPlaying && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-mist-500">
          Play something to see it move.
        </p>
      )}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? "bg-ember" : "bg-ink-600"}`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-mist-100 transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
      <span className="text-sm text-mist-300">{checked ? "On" : "Off"}</span>
    </label>
  );
}

export default function SoundView({ analyser, isPlaying, trackTitle, settings, onChange }: SoundViewProps) {
  const available = analyser !== null;

  function setBand(index: number, value: number) {
    const gains = [...settings.eqGains];
    gains[index] = value;
    const preset = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === gains[i]))?.[0] ?? "Custom";
    onChange({ ...settings, eqEnabled: true, eqGains: gains, eqPreset: preset });
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <h1 className="font-display text-xl font-semibold">Sound</h1>
      <p className="text-sm text-mist-500 mt-1 mb-6 truncate">{trackTitle ?? "Nothing playing"}</p>

      {!available && (
        <div className="max-w-3xl bg-ink-800 border border-ink-700 rounded-xl px-5 py-4 mb-4">
          <p className="text-sm text-mist-100">Audio effects are off</p>
          <p className="text-xs text-mist-500 mt-1 leading-relaxed">
            The visualizer, equalizer and volume levelling need Playnest's local audio relay, which
            couldn't start this time. Playback works normally without it. Restarting Playnest usually
            fixes this.
          </p>
        </div>
      )}

      <div className={`max-w-3xl flex flex-col gap-4 ${available ? "" : "opacity-50 pointer-events-none"}`}>
        <section className="bg-ink-800 border border-ink-700 rounded-xl px-5 py-4">
          <h2 className="text-sm font-medium text-mist-100 mb-3">Visualizer</h2>
          {analyser ? <Visualizer analyser={analyser} isPlaying={isPlaying} /> : <div className="h-44" />}
        </section>

        <section className="bg-ink-800 border border-ink-700 rounded-xl px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-mist-100">Equalizer</h2>
              <p className="text-xs text-mist-500 mt-1">Pick a preset or drag the bands. Changes apply instantly.</p>
            </div>
            <Switch
              checked={settings.eqEnabled}
              onChange={(eqEnabled) => onChange({ ...settings, eqEnabled })}
              label="Equalizer"
            />
          </div>

          <div className="flex flex-wrap gap-2 mt-4" role="radiogroup" aria-label="Equalizer preset">
            {[...Object.keys(EQ_PRESETS), ...(settings.eqPreset === "Custom" ? ["Custom"] : [])].map((name) => {
              const active = settings.eqPreset === name;
              return (
                <button
                  key={name}
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    name !== "Custom" &&
                    onChange({ ...settings, eqEnabled: true, eqPreset: name, eqGains: [...EQ_PRESETS[name]] })
                  }
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    active ? "bg-ember text-ink-950 border-ember" : "border-ink-600 text-mist-300 hover:border-mist-500"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>

          <div className={`mt-5 grid grid-cols-10 gap-2 ${settings.eqEnabled ? "" : "opacity-50"}`}>
            {EQ_FREQUENCIES.map((hz, i) => {
              const value = settings.eqGains[i] ?? 0;
              return (
                <div key={hz} className="flex flex-col items-center gap-2">
                  <span className="text-[11px] tabular-nums text-mist-300 h-4">
                    {value > 0 ? `+${value}` : value}
                  </span>
                  <input
                    type="range"
                    min={-EQ_MAX_DB}
                    max={EQ_MAX_DB}
                    step={1}
                    value={value}
                    onChange={(e) => setBand(i, Number(e.target.value))}
                    aria-label={`${formatHz(hz)}Hz band`}
                    className="accent-ember h-32 w-4"
                    style={{ writingMode: "vertical-lr", direction: "rtl" }}
                  />
                  <span className="text-[11px] text-mist-500">{formatHz(hz)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-ink-800 border border-ink-700 rounded-xl px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div>
              <h2 className="text-sm font-medium text-mist-100">Volume levelling</h2>
              <p className="text-xs text-mist-500 mt-1 leading-relaxed max-w-lg">
                Evens out the volume between tracks, so a quiet old upload and a loud new one play at a
                similar level. It adjusts gradually in the first few seconds of each track and leaves the
                song's own loud and quiet parts alone.
              </p>
            </div>
            <Switch
              checked={settings.levelling}
              onChange={(levelling) => onChange({ ...settings, levelling })}
              label="Volume levelling"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
