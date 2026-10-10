import { useEffect, useState } from "react";

export type SleepTimer =
  | { kind: "minutes"; endsAt: number }
  | { kind: "endOfTrack" }
  | null;

interface SleepTimerMenuProps {
  timer: SleepTimer;
  onSet: (timer: SleepTimer) => void;
  /** Classic layout: a skinned "SLEEP" button, with the menu opening downward. */
  classic?: boolean;
}

const MINUTE_OPTIONS = [15, 30, 45, 60, 90];

function remainingLabel(endsAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((endsAt - now) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export default function SleepTimerMenu({ timer, onSet, classic = false }: SleepTimerMenuProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Keep the countdown label fresh while a timed sleep is set.
  useEffect(() => {
    if (timer?.kind !== "minutes") return;
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [timer]);

  const label =
    timer?.kind === "minutes"
      ? remainingLabel(timer.endsAt, now)
      : timer?.kind === "endOfTrack"
        ? "End of track"
        : null;

  function choose(next: SleepTimer) {
    onSet(next);
    setOpen(false);
  }

  const itemClass = classic ? "" : "w-full text-left px-3 py-1.5 text-sm text-mist-100 hover:bg-ink-700";

  const menuPosition = classic ? "top-6 right-0" : "bottom-8 right-0";

  return (
    <div className="relative">
      {classic ? (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={label ? `Sleep timer: ${label}` : "Sleep timer"}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-pressed={timer !== null}
          title={label ? `Sleep timer: ${label}` : "Sleep timer"}
          className="cw-btn cw-toggle"
        >
          ZZ
        </button>
      ) : (
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label ? `Sleep timer: ${label}` : "Sleep timer"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Sleep timer"
        className={`flex items-center gap-1 text-xs ${timer ? "text-ember" : "text-mist-500 hover:text-mist-100"}`}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5a5.8 5.8 0 1 0 7 7Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {label && <span className="tabular-nums">{label}</span>}
      </button>
      )}

      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={`absolute ${menuPosition} z-50 ${
              classic ? "cw-menu" : "w-44 bg-ink-800 border border-ink-700 rounded-lg shadow-xl py-2"
            }`}
          >
            <p className={classic ? "px-[10px] pt-[4px] pb-[3px] text-[10px] opacity-70" : "px-3 pb-1 text-xs font-medium text-mist-500 uppercase tracking-wide"}>Stop playing in</p>
            {MINUTE_OPTIONS.map((m) => (
              <button key={m} className={itemClass} onClick={() => choose({ kind: "minutes", endsAt: Date.now() + m * 60000 })}>
                {m} minutes
              </button>
            ))}
            <button className={itemClass} onClick={() => choose({ kind: "endOfTrack" })}>
              End of this track
            </button>
            {timer && (
              <>
                {classic ? <hr /> : <div className="h-px bg-ink-700 my-1.5" />}
                <button className={itemClass} onClick={() => choose(null)}>
                  Turn off
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
