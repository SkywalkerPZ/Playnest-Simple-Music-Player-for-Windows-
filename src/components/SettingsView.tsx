import { ReactNode, useEffect, useState } from "react";
import { CROSSFADE_OPTIONS, Layout, Settings, SKINS } from "../lib/settings";
import { YtdlpStatus } from "./SearchView";

interface SettingsViewProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  onShowWelcome: () => void;
  ytdlp: YtdlpStatus;
  onLoadYtdlpVersion: () => void;
  onUpdateYtdlp: () => void;
  /** Resolve with a message, or null if the user cancelled the dialog. */
  onExportBackup: () => Promise<string | null>;
  onRestoreBackup: () => Promise<string | null>;
  appVersion: string | null;
  /** Resolves with a message to show. */
  onCheckAppUpdate: () => Promise<string | null>;
  onShowChangelog: () => void;
}

function AppUpdateSection({
  version,
  onCheck,
  onShowChangelog,
}: {
  version: string | null;
  onCheck: () => Promise<string | null>;
  onShowChangelog: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setChecking(true);
    setMessage(null);
    try {
      setMessage(await onCheck());
    } finally {
      setChecking(false);
    }
  }

  return (
    <Section
      title="Playnest updates"
      description="Playnest checks for a new version by itself about twice a day and shows you what's new before anything is installed."
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-mist-300">
          Version <span className="tabular-nums text-mist-100">{version ?? "…"}</span>
        </span>
        <button
          onClick={run}
          disabled={checking}
          className="text-xs font-medium px-3 py-1.5 rounded-full bg-ember text-ink-950 hover:bg-ember-dim disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
        <button
          onClick={onShowChangelog}
          className="text-xs font-medium px-3 py-1.5 rounded-full border border-ink-600 text-mist-300 hover:border-mist-500"
        >
          What's new
        </button>
      </div>
      {message && <p className="text-xs mt-2 leading-relaxed text-mist-500 break-words">{message}</p>}
    </Section>
  );
}

function BackupSection({
  onExport,
  onRestore,
}: {
  onExport: () => Promise<string | null>;
  onRestore: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  async function run(kind: "export" | "restore", action: () => Promise<string | null>) {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await action();
      if (result) setMessage({ text: result, failed: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), failed: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="Backup"
      description="Save your playlists, liked songs, listening history, searches and settings to one file, and restore them later or on another PC. Restoring merges into what's already here and never deletes anything, but settings are replaced by the backup's. Downloaded audio isn't included; download those again after restoring."
    >
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("export", onExport)}
          disabled={busy !== null}
          className="text-xs font-medium px-3 py-1.5 rounded-full bg-ember text-ink-950 hover:bg-ember-dim disabled:opacity-50"
        >
          {busy === "export" ? "Saving…" : "Export library"}
        </button>
        <button
          onClick={() => run("restore", onRestore)}
          disabled={busy !== null}
          className="text-xs font-medium px-3 py-1.5 rounded-full border border-ink-600 text-mist-300 hover:border-mist-500 disabled:opacity-50"
        >
          {busy === "restore" ? "Restoring…" : "Restore from a backup"}
        </button>
      </div>
      {message && (
        <p className={`text-xs mt-2 leading-relaxed break-words ${message.failed ? "text-ember-soft" : "text-mist-500"}`}>
          {message.text}
        </p>
      )}
    </Section>
  );
}

const IN_APP_SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["N", "Next track"],
  ["P", "Previous track"],
  ["L", "Like / unlike current track"],
  ["← / →", "Seek back / forward 5s"],
  ["↑ / ↓", "Volume up / down"],
];

const GLOBAL_SHORTCUTS: [string, string][] = [
  ["Ctrl + Alt + Space", "Play / pause"],
  ["Ctrl + Alt + →", "Next track"],
  ["Ctrl + Alt + ←", "Previous track"],
];

const LAYOUTS: { id: Layout; name: string }[] = [
  { id: "classic", name: "Classic" },
  { id: "modern", name: "Modern" },
];

function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  note,
}: {
  label: string;
  options: { id: T; name: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-mist-500 w-14">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 ${
                active ? "bg-ember text-ink-950 border-ember" : "border-ink-600 text-mist-300 hover:border-mist-500"
              }`}
            >
              {option.name}
            </button>
          );
        })}
      </div>
      {note && <span className="text-xs text-mist-500">{note}</span>}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="bg-ink-800 border border-ink-700 rounded-xl px-5 py-4">
      <h2 className="text-sm font-medium text-mist-100">{title}</h2>
      {description && <p className="text-xs text-mist-500 mt-1 leading-relaxed">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ShortcutTable({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
      {rows.map(([keys, action]) => (
        <div key={keys} className="contents">
          <dt>
            <kbd className="text-xs font-sans px-1.5 py-0.5 rounded bg-ink-900 border border-ink-700 text-mist-300">
              {keys}
            </kbd>
          </dt>
          <dd className="text-mist-500">{action}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function SettingsView({
  settings,
  onChange,
  onShowWelcome,
  ytdlp,
  onLoadYtdlpVersion,
  onUpdateYtdlp,
  onExportBackup,
  onRestoreBackup,
  appVersion,
  onCheckAppUpdate,
  onShowChangelog,
}: SettingsViewProps) {
  useEffect(() => {
    onLoadYtdlpVersion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <h1 className="font-display text-xl font-semibold mb-6">Settings</h1>

      <div className="flex flex-col gap-4 max-w-xl">
        <Section
          title="Appearance"
          description="Classic is the compact player with an equalizer and playlist stacked underneath; the library opens beside it when you need it. Modern is the full window with a sidebar."
        >
          <div className="flex flex-col gap-3">
            <ChoiceRow
              label="Layout"
              options={LAYOUTS}
              value={settings.layout}
              onChange={(layout) => onChange({ ...settings, layout })}
            />
            <ChoiceRow
              label="Skin"
              options={SKINS.map((s) => ({ id: s.id, name: s.name }))}
              value={settings.skin}
              onChange={(skin) => onChange({ ...settings, skin })}
              disabled={settings.layout !== "classic"}
              note={settings.layout !== "classic" ? "Skins apply to the classic layout." : undefined}
            />
          </div>
        </Section>

        <AppUpdateSection version={appVersion} onCheck={onCheckAppUpdate} onShowChangelog={onShowChangelog} />

        <Section
          title="Autoplay"
          description="When your queue runs out, keep playing tracks like the last one, picked from the same artist and your other favourites."
        >
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              role="switch"
              aria-checked={settings.autoplay}
              onClick={() => onChange({ ...settings, autoplay: !settings.autoplay })}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                settings.autoplay ? "bg-ember" : "bg-ink-600"
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-mist-100 transition-transform ${
                  settings.autoplay ? "translate-x-4" : ""
                }`}
              />
            </button>
            <span className="text-sm text-mist-300">{settings.autoplay ? "On" : "Off"}</span>
          </label>
        </Section>

        <Section
          title="Crossfade"
          description="Blend the end of one track into the start of the next. Also applies when you skip."
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Crossfade length">
            {CROSSFADE_OPTIONS.map((seconds) => {
              const active = settings.crossfadeSeconds === seconds;
              return (
                <button
                  key={seconds}
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...settings, crossfadeSeconds: seconds })}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    active
                      ? "bg-ember text-ink-950 border-ember"
                      : "border-ink-600 text-mist-300 hover:border-mist-500"
                  }`}
                >
                  {seconds === 0 ? "Off" : `${seconds}s`}
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          title="yt-dlp"
          description="The tool Playnest uses to search and stream. Playnest keeps its own copy and updates it automatically once a day, because older versions stop working when YouTube changes something. If search or playback suddenly breaks, check for an update here."
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-mist-300">
              {ytdlp.version ? (
                <>
                  Installed version <span className="tabular-nums text-mist-100">{ytdlp.version}</span>
                </>
              ) : (
                "Checking version…"
              )}
            </span>
            <button
              onClick={onUpdateYtdlp}
              disabled={ytdlp.updating}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-ember text-ink-950 hover:bg-ember-dim disabled:opacity-50"
            >
              {ytdlp.updating ? "Updating…" : "Check for updates"}
            </button>
          </div>
          {ytdlp.message && (
            <p className={`text-xs mt-2 leading-relaxed ${ytdlp.failed ? "text-ember-soft" : "text-mist-500"}`}>
              {ytdlp.message}
            </p>
          )}
        </Section>

        <Section
          title="Global hotkeys"
          description="These work even when Playnest is in the background, e.g. while you're in a game. If another app already uses one, that one just won't do anything."
        >
          <ShortcutTable rows={GLOBAL_SHORTCUTS} />
        </Section>

        <Section title="Keyboard shortcuts" description="While the Playnest window is focused.">
          <ShortcutTable rows={IN_APP_SHORTCUTS} />
        </Section>

        <BackupSection onExport={onExportBackup} onRestore={onRestoreBackup} />

        <Section title="Welcome screen">
          <button
            onClick={onShowWelcome}
            className="text-xs font-medium px-3 py-1.5 rounded-full text-mist-300 border border-ink-600 hover:border-mist-500"
          >
            Show the welcome screen again
          </button>
        </Section>
      </div>
    </div>
  );
}
