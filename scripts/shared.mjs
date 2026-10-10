// Helpers shared by the updater setup and release scripts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONF_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");

/** Where the private signing key lives. Keep it out of the project folder. */
export const KEY_PATH =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || path.join(os.homedir(), ".tauri", "playnest.key");

export function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** Run the project's Tauri CLI without going through a shell. */
export function tauri(args, env = {}) {
  const cli = path.join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
  if (!fs.existsSync(cli)) fail("The Tauri CLI isn't installed. Run `npm install` first.");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return result.status === 0;
}

/** The "## x.y.z" section of CHANGELOG.md, as text. */
export function changelogSection(version) {
  const file = path.join(ROOT, "CHANGELOG.md");
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, "\\.")}(\\s|$)`).test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}
