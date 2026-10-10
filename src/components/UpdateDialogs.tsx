import { ReactNode, useState } from "react";
import { ChangelogEntry } from "../lib/changelog";

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** Renders changelog lines: "- item" bullets, "### heading", plain text. */
export function ReleaseNotes({ lines }: { lines: string[] }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1.5">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    flush();
    if (!line) continue;
    if (line.startsWith("#")) {
      blocks.push(
        <p key={`h-${blocks.length}`} className="font-medium text-mist-100 mt-2">
          {line.replace(/^#+\s*/, "")}
        </p>
      );
    } else {
      blocks.push(<p key={`p-${blocks.length}`}>{line}</p>);
    }
  }
  flush();
  return <div className="text-sm text-mist-300 leading-relaxed space-y-2">{blocks}</div>;
}

function Modal({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-md max-h-[90vh] flex flex-col bg-ink-800 border border-ink-700 rounded-xl shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

const primaryBtn = "text-sm font-medium px-4 py-2 rounded-full bg-ember text-ink-950 hover:bg-ember-dim disabled:opacity-50";
const quietBtn = "text-sm px-3 py-2 rounded-full text-mist-500 hover:text-mist-100 disabled:opacity-40";

interface UpdateDialogProps {
  currentVersion: string;
  version: string;
  date: string | null;
  /** Release notes from the update site. */
  notes: string;
  onInstall: (onProgress: (downloaded: number, total: number | null) => void) => Promise<void>;
  onLater: () => void;
  onSkip: () => void;
}

/** "A new version is available", with the changelog, then download progress. */
export function UpdateDialog({ currentVersion, version, date, notes, onInstall, onLater, onSkip }: UpdateDialogProps) {
  const [phase, setPhase] = useState<"ask" | "downloading" | "installing" | "error">("ask");
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null });
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setPhase("downloading");
    setError(null);
    try {
      await onInstall((downloaded, total) => {
        setProgress({ downloaded, total });
        if (total && downloaded >= total) setPhase("installing");
      });
      setPhase("installing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  const busy = phase === "downloading" || phase === "installing";
  const fraction = progress.total ? Math.min(1, progress.downloaded / progress.total) : null;
  const when = date ? new Date(date) : null;

  return (
    <Modal labelledBy="update-title">
      <div className="px-6 pt-6">
        <p className="text-xs font-medium uppercase tracking-wide text-ember">Update available</p>
        <h2 id="update-title" className="font-display text-lg font-semibold mt-1">
          Playnest {version}
        </h2>
        <p className="text-xs text-mist-500 mt-1">
          You have {currentVersion}
          {when && !Number.isNaN(when.getTime()) ? ` · released ${when.toLocaleDateString()}` : ""}
        </p>
      </div>

      <div className="px-6 mt-4 overflow-y-auto min-h-0">
        <p className="text-xs font-medium uppercase tracking-wide text-mist-500 mb-2">What's new</p>
        {notes.trim() ? (
          <ReleaseNotes lines={notes.split(/\r?\n/)} />
        ) : (
          <p className="text-sm text-mist-500">No notes for this version.</p>
        )}
      </div>

      <div className="px-6 pb-6 pt-5">
        {busy && (
          <div role="status" aria-live="polite">
            <div className="h-2 rounded-full bg-ink-700 overflow-hidden">
              <div
                className={`h-full bg-ember rounded-full transition-[width] duration-200 ${fraction === null ? "w-1/3 animate-pulse" : ""}`}
                style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
              />
            </div>
            <p className="text-xs text-mist-500 mt-2 tabular-nums">
              {phase === "installing"
                ? "Installing… Playnest will restart by itself."
                : progress.downloaded > 0
                  ? `Downloading ${mb(progress.downloaded)}${progress.total ? ` of ${mb(progress.total)}` : ""} MB`
                  : "Starting download…"}
            </p>
          </div>
        )}
        {phase === "error" && <p className="text-xs text-ember-soft break-words mb-3">{error}</p>}
        {!busy && (
          <div className="flex items-center justify-between gap-2">
            <button onClick={onSkip} className={quietBtn}>
              Skip this version
            </button>
            <div className="flex gap-2">
              <button onClick={onLater} className={quietBtn}>
                Later
              </button>
              <button onClick={install} className={primaryBtn} autoFocus>
                {phase === "error" ? "Try again" : "Update now"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Changelog for one version (after updating) or all of them. */
export function ChangelogDialog({
  title,
  entries,
  onClose,
}: {
  title: string;
  entries: ChangelogEntry[];
  onClose: () => void;
}) {
  return (
    <Modal labelledBy="changelog-title">
      <div className="px-6 pt-6">
        <h2 id="changelog-title" className="font-display text-lg font-semibold">
          {title}
        </h2>
      </div>
      <div className="px-6 mt-4 overflow-y-auto min-h-0 space-y-5">
        {entries.map((entry) => (
          <section key={entry.version}>
            <p className="text-xs font-medium uppercase tracking-wide text-mist-500 mb-2">
              Version {entry.version}
              {entry.date ? ` · ${entry.date}` : ""}
            </p>
            <ReleaseNotes lines={entry.lines} />
          </section>
        ))}
      </div>
      <div className="px-6 pb-6 pt-5 flex justify-end">
        <button onClick={onClose} className={primaryBtn} autoFocus>
          Got it
        </button>
      </div>
    </Modal>
  );
}
