import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

/** Ask the update site whether there's a newer Playnest. */
export function findAppUpdate(): Promise<Update | null> {
  return check({ timeout: 20000 });
}

export async function installAppUpdate(
  update: Update,
  onProgress: (downloaded: number, total: number | null) => void
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress(0, total);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(downloaded, total);
    }
  });
  // On Windows the installer closes Playnest itself and reopens it when
  // done; elsewhere, restart into the new version.
  await relaunch();
}

/** Plain-language version of an update error. */
export function describeUpdateError(err: unknown): string {
  const text = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  if (lower.includes("endpoints")) {
    return "Updates aren't set up yet. See the README section “Updates” for the one-time setup.";
  }
  if (lower.includes("signature")) {
    return "The update's signature didn't match, so it wasn't installed. If you're the one publishing updates, check that you signed it with the Playnest key.";
  }
  if (lower.includes("network") || lower.includes("connect") || lower.includes("dns") || lower.includes("timed out") || lower.includes("request")) {
    return "Couldn't reach the update site. Check the internet connection and try again.";
  }
  return `Couldn't check for updates: ${text}`;
}
