import { FormEvent, useEffect, useState } from "react";

interface ImportPlaylistDialogProps {
  onClose: () => void;
  /** Resolves with a short success message, rejects with a readable error. */
  onImport: (url: string) => Promise<string>;
}

export default function ImportPlaylistDialog({ onClose, onImport }: ImportPlaylistDialogProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await onImport(url.trim()));
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className="w-full max-w-md bg-ink-800 border border-ink-700 rounded-xl p-6 shadow-2xl"
      >
        <h2 id="import-title" className="font-display text-lg font-semibold">
          Import a playlist
        </h2>
        <p className="text-sm text-mist-500 mt-1">
          Paste a YouTube or YouTube Music playlist link. It becomes a normal Playnest playlist
          you can edit.
        </p>

        {done ? (
          <>
            <p className="mt-5 text-sm text-mist-100">{done}</p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="text-sm font-medium px-4 py-2 rounded-full bg-ember text-ink-950 hover:bg-ember-dim"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=…"
              aria-label="Playlist link"
              disabled={busy}
              className="mt-5 w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm text-mist-100 placeholder:text-mist-500 focus:border-ember disabled:opacity-60"
            />
            {busy && (
              <p className="mt-3 text-xs text-mist-500">
                Reading the playlist… big ones can take a little while.
              </p>
            )}
            {error && <p className="mt-3 text-xs text-ember-soft break-words">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="text-sm px-4 py-2 rounded-full text-mist-500 hover:text-mist-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !url.trim()}
                className="text-sm font-medium px-4 py-2 rounded-full bg-ember text-ink-950 hover:bg-ember-dim disabled:opacity-40"
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
