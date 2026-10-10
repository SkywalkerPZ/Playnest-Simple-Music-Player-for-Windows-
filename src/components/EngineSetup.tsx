export interface EngineState {
  status: "checking" | "ready" | "installing" | "failed";
  downloaded: number;
  total: number | null;
  error: string | null;
}

interface EngineSetupProps {
  engine: EngineState;
  onRetry: () => void;
  onSkip: () => void;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** First launch on a PC without yt-dlp: Playnest downloads its own copy. */
export default function EngineSetup({ engine, onRetry, onSkip }: EngineSetupProps) {
  const failed = engine.status === "failed";
  const fraction = engine.total ? Math.min(1, engine.downloaded / engine.total) : null;

  return (
    <div className="h-screen bg-ink-900 text-mist-100 flex items-center justify-center px-8">
      <div className="w-full max-w-md">
        <h1 className="font-display text-xl font-semibold">
          {failed ? "Couldn't finish setting up" : "Getting Playnest ready"}
        </h1>
        <p className="text-sm text-mist-500 mt-2 leading-relaxed">
          {failed
            ? "Playnest needs to download yt-dlp, the free tool it uses to find and play music (about 18 MB, only once), but the download didn't work."
            : "Playnest is downloading yt-dlp, the free tool it uses to find and play music. This only happens once (about 18 MB), and it keeps itself up to date after that."}
        </p>

        {!failed && (
          <div className="mt-6" role="status" aria-live="polite">
            <div
              className="h-2 rounded-full bg-ink-700 overflow-hidden"
              role="progressbar"
              aria-label="Download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
            >
              <div
                className={`h-full bg-ember rounded-full transition-[width] duration-200 ${fraction === null ? "w-1/3 animate-pulse" : ""}`}
                style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
              />
            </div>
            <p className="text-xs text-mist-500 mt-2 tabular-nums">
              {engine.downloaded > 0
                ? `${mb(engine.downloaded)}${engine.total ? ` of ${mb(engine.total)}` : ""} MB`
                : "Connecting…"}
            </p>
          </div>
        )}

        {failed && (
          <>
            <p className="mt-4 text-sm text-ember-soft bg-ink-800 border border-ink-700 rounded-lg p-3 break-words">
              {engine.error}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={onRetry}
                className="text-sm font-medium px-4 py-2 rounded-full bg-ember text-ink-950 hover:bg-ember-dim"
              >
                Try again
              </button>
              <button
                onClick={onSkip}
                className="text-sm font-medium px-4 py-2 rounded-full border border-ink-600 text-mist-300 hover:border-mist-500"
              >
                Continue without it
              </button>
            </div>
            <p className="text-xs text-mist-500 mt-3 leading-relaxed">
              Without it, search and streaming won't work, but downloaded songs still play. You can retry any time
              from Settings → yt-dlp → Check for updates.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
