import { useState } from "react";
import { EQ_FREQUENCIES, EQ_MAX_DB, EQ_PRESETS } from "../lib/audioGraph";
import { Settings } from "../lib/settings";
import { PopupMenu, TitleBar, VSlider } from "./parts";

interface EqualizerWindowProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  effectsAvailable: boolean;
  onClose: () => void;
}

const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}K` : String(hz));

/** The EQ curve, drawn like the little response graph on a classic EQ. */
function CurveDisplay({ gains, preamp, on }: { gains: number[]; preamp: number; on: boolean }) {
  const w = 113;
  const h = 19;
  const y = (db: number) => h / 2 - (db / EQ_MAX_DB) * (h / 2 - 2);
  const points = gains.map((g, i) => `${(i / (gains.length - 1)) * (w - 4) + 2},${y(g).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="cw-lcd block" aria-hidden="true">
      <line x1="0" x2={w} y1={y(preamp)} y2={y(preamp)} stroke="var(--cw-lcd-dim)" strokeDasharray="2 2" />
      <polyline points={points} fill="none" stroke={on ? "var(--cw-lcd-fg)" : "var(--cw-lcd-dim)"} strokeWidth="1.2" />
    </svg>
  );
}

export default function EqualizerWindow({ settings, onChange, effectsAvailable, onClose }: EqualizerWindowProps) {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const disabled = !effectsAvailable;

  function setBand(index: number, db: number) {
    const eqGains = settings.eqGains.map((g, i) => (i === index ? db : g));
    onChange({ ...settings, eqGains, eqPreset: "Custom", eqEnabled: true });
  }

  function applyPreset(name: string) {
    onChange({ ...settings, eqGains: [...EQ_PRESETS[name]], eqPreset: name, eqEnabled: true });
    setPresetsOpen(false);
  }

  return (
    <section className="cw-window" aria-label="Equalizer">
      <TitleBar title="PLAYNEST EQUALIZER" onClose={onClose} closeLabel="Hide equalizer" />

      <div className="flex items-center gap-[4px]">
        <button
          className="cw-btn cw-toggle"
          aria-pressed={settings.eqEnabled}
          onClick={() => onChange({ ...settings, eqEnabled: !settings.eqEnabled })}
          disabled={disabled}
          title="Turn the equalizer on or off"
        >
          ON
        </button>
        <button
          className="cw-btn cw-toggle"
          aria-pressed={settings.levelling}
          onClick={() => onChange({ ...settings, levelling: !settings.levelling })}
          disabled={disabled}
          title="Volume levelling: evens out loudness between tracks"
        >
          LEVEL
        </button>
        <div className="mx-auto flex items-center gap-[6px] min-w-0">
          {effectsAvailable ? (
            <>
              <CurveDisplay gains={settings.eqGains} preamp={settings.eqPreamp} on={settings.eqEnabled} />
              <span className="cw-label truncate max-w-[90px]" title={`Preset: ${settings.eqPreset}`}>
                {settings.eqPreset.toUpperCase()}
              </span>
            </>
          ) : (
            <span className="cw-label">EFFECTS UNAVAILABLE</span>
          )}
        </div>
        <div className="relative">
          <button
            className="cw-btn"
            onClick={() => setPresetsOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={presetsOpen}
            disabled={disabled}
          >
            PRESETS ▾
          </button>
          <PopupMenu open={presetsOpen} onClose={() => setPresetsOpen(false)} label="Equalizer presets" className="right-0 top-[20px]">
            {Object.keys(EQ_PRESETS).map((name) => (
              <button key={name} role="menuitemradio" aria-checked={settings.eqPreset === name} onClick={() => applyPreset(name)}>
                {settings.eqPreset === name ? "• " : ""}
                {name}
              </button>
            ))}
            <hr />
            <button
              role="menuitem"
              onClick={() => {
                onChange({ ...settings, eqPreamp: 0 });
                setPresetsOpen(false);
              }}
            >
              Reset preamp
            </button>
          </PopupMenu>
        </div>
      </div>

      <div className="flex items-stretch mt-[6px] gap-[2px]">
        {/* Preamp */}
        <div className="flex flex-col items-center w-[34px]">
          <div className="h-[64px]">
            <VSlider
              label="Preamp"
              value={settings.eqPreamp}
              min={-EQ_MAX_DB}
              max={EQ_MAX_DB}
              onChange={(eqPreamp) => onChange({ ...settings, eqPreamp, eqEnabled: true })}
              disabled={disabled}
            />
          </div>
          <span className="cw-label mt-[4px]">PREAMP</span>
        </div>

        {/* dB scale */}
        <div className="flex flex-col justify-between h-[64px] w-[26px] text-right pr-[3px]" aria-hidden="true">
          <span className="cw-label">+12</span>
          <span className="cw-label">0</span>
          <span className="cw-label">-12</span>
        </div>

        {/* Bands */}
        <div className="flex-1 flex justify-between">
          {EQ_FREQUENCIES.map((hz, i) => (
            <div key={hz} className="flex flex-col items-center w-[28px]">
              <div className="h-[64px]">
                <VSlider
                  label={`${bandLabel(hz)}Hz`}
                  value={settings.eqGains[i] ?? 0}
                  min={-EQ_MAX_DB}
                  max={EQ_MAX_DB}
                  onChange={(db) => setBand(i, db)}
                  disabled={disabled}
                />
              </div>
              <span className="cw-label mt-[4px]">{bandLabel(hz)}</span>
            </div>
          ))}
        </div>
      </div>
      {!effectsAvailable && (
        <p className="cw-label mt-[5px] leading-[1.4] normal-case" style={{ fontFamily: "var(--font-sans)", fontSize: 10 }}>
          The equalizer needs Playnest's audio relay, which didn't start. Restarting the app usually fixes it.
        </p>
      )}
    </section>
  );
}
