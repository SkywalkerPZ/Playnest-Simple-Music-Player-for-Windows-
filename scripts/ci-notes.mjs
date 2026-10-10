// Used by the GitHub release workflow: checks the version numbers agree
// (and match the pushed tag), then hands the CHANGELOG section for this
// version to the workflow as the release notes.
//
//   node scripts/ci-notes.mjs v0.2.3
import fs from "node:fs";
import path from "node:path";
import { CONF_PATH, ROOT, changelogSection, fail, readJson } from "./shared.mjs";

const tag = process.argv[2] ?? "";
const version = readJson(CONF_PATH).version;
const pkgVersion = readJson(path.join(ROOT, "package.json")).version;
const cargoVersion = fs
  .readFileSync(path.join(ROOT, "src-tauri", "Cargo.toml"), "utf8")
  .match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (pkgVersion !== version || cargoVersion !== version) {
  fail(`Version numbers don't match: package.json ${pkgVersion}, tauri.conf.json ${version}, Cargo.toml ${cargoVersion}.`);
}
if (tag.startsWith("v") && tag !== `v${version}`) {
  fail(`The tag ${tag} doesn't match the app version ${version}. Tag it v${version}.`);
}
const conf = readJson(CONF_PATH);
if (!conf.plugins?.updater?.pubkey || !conf.bundle?.createUpdaterArtifacts) {
  fail("Updates aren't set up in tauri.conf.json (pubkey / createUpdaterArtifacts).");
}
const notes = changelogSection(version);
if (!notes) fail(`CHANGELOG.md has no "## ${version}" section.`);

const out = process.env.GITHUB_OUTPUT;
const body = `${notes}\n`;
if (out) {
  const marker = `NOTES_${Date.now()}`;
  fs.appendFileSync(out, `version=${version}\nbody<<${marker}\n${body}${marker}\n`);
}
console.log(`Playnest ${version}\n\n${body}`);
