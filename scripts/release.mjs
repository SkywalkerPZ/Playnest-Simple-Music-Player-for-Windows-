// Build a Playnest release and put everything the update site needs into
// the "release" folder:
//
//   npm run release
//
// Then drag the release folder onto your Netlify site's Deploys page.
// Add --skip-build to reuse the last build.
import fs from "node:fs";
import path from "node:path";
import { CONF_PATH, KEY_PATH, ROOT, changelogSection, fail, readJson, tauri } from "./shared.mjs";

const skipBuild = process.argv.includes("--skip-build");

// --- versions must agree everywhere ---
const pkgVersion = readJson(path.join(ROOT, "package.json")).version;
const conf = readJson(CONF_PATH);
const cargoVersion = fs
  .readFileSync(path.join(ROOT, "src-tauri", "Cargo.toml"), "utf8")
  .match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const version = conf.version;
if (pkgVersion !== version || cargoVersion !== version) {
  fail(
    `The version numbers don't match. Set the same new version in all three:\n` +
      `  package.json             ${pkgVersion}\n` +
      `  src-tauri/tauri.conf.json ${version}\n` +
      `  src-tauri/Cargo.toml      ${cargoVersion}`
  );
}

// --- updater must be set up ---
const updater = conf.plugins?.updater;
// The Netlify site (GitHub releases are published by the GitHub workflow).
const endpoint = updater?.endpoints?.find((e) => !e.includes("github.com"));
if (!endpoint || !updater?.pubkey || !conf.bundle?.createUpdaterArtifacts) {
  fail(
    updater?.endpoints?.length
      ? "There's no Netlify address in tauri.conf.json, so releases go through GitHub: push a version tag (see README)."
      : "Updates aren't set up yet. Run  npm run updater:setup -- https://your-site.netlify.app  first."
  );
}
const base = endpoint.replace(/\/latest\.json$/, "");

if (!fs.existsSync(KEY_PATH)) fail(`Your signing key isn't at ${KEY_PATH}. Restore it from your backup.`);
const pubPath = `${KEY_PATH}.pub`;
if (fs.existsSync(pubPath) && fs.readFileSync(pubPath, "utf8").trim() !== updater.pubkey.trim()) {
  fail(`The key at ${KEY_PATH} isn't the one in tauri.conf.json. Installed copies would reject this release.`);
}

// --- what's new ---
const notes = changelogSection(version);
if (!notes) fail(`CHANGELOG.md has no "## ${version}" section. Write what's new in this version first.`);

// The key's contents, as the Tauri CLI expects them.
const signingEnv = {
  TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(KEY_PATH, "utf8").trim(),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  // Tauri refuses to be given the key both ways at once.
  TAURI_SIGNING_PRIVATE_KEY_PATH: undefined,
};

// --- build ---
if (!skipBuild) {
  console.log(`Building Playnest ${version}…`);
  // The build reads the key itself (not its path) from this variable.
  const ok = tauri(["build"], signingEnv);
  if (!ok) fail("The build failed (see above).");
}

// --- find the installer and its signature ---
const nsisDir = path.join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
if (!fs.existsSync(nsisDir)) fail(`No Windows installer found in ${nsisDir}. Releases are built on Windows.`);
const installers = fs
  .readdirSync(nsisDir)
  .filter((f) => f.endsWith("-setup.exe") && f.includes(`_${version}_`));
if (installers.length === 0) fail(`No installer for version ${version} in ${nsisDir}.`);

const ARCH = { x64: "x86_64", arm64: "aarch64", x86: "i686" };
const platforms = {};
const files = [];
for (const installer of installers) {
  const arch = installer.match(/_(x64|arm64|x86)-setup\.exe$/)?.[1];
  if (!arch) continue;
  const sigFile = path.join(nsisDir, `${installer}.sig`);
  const installerPath = path.join(nsisDir, installer);
  const stale = fs.existsSync(sigFile) && fs.statSync(sigFile).mtimeMs < fs.statSync(installerPath).mtimeMs;
  if (!fs.existsSync(sigFile) || stale) {
    // Built without the key (or signed before a rebuild): sign it now.
    console.log(`Signing ${installer}…`);
    if (!tauri(["signer", "sign", "--app-version", version, installerPath], signingEnv) || !fs.existsSync(sigFile)) {
      fail(`Couldn't sign ${installer}.`);
    }
  }
  // Lowercase: Netlify stores file names in lowercase, so the link in
  // latest.json must be lowercase too or the download would 404.
  const publishedName = `playnest_${version}_${arch}-setup.exe`;
  platforms[`windows-${ARCH[arch]}`] = {
    signature: fs.readFileSync(sigFile, "utf8").trim(),
    url: `${base}/${encodeURIComponent(publishedName)}`,
  };
  files.push({ from: path.join(nsisDir, installer), name: publishedName, arch });
}
if (files.length === 0) fail("Couldn't tell which processor the installer is for.");

// --- assemble the release folder ---
const out = path.join(ROOT, "release");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of files) fs.copyFileSync(f.from, path.join(out, f.name));

const latest = { version, notes, pub_date: new Date().toISOString(), platforms };
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(latest, null, 2) + "\n");

// A simple page for the first install: send family the site address.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const noteItems = notes
  .split(/\r?\n/)
  .filter((l) => /^\s*[-*]\s+/.test(l))
  .map((l) => `<li>${esc(l.replace(/^\s*[-*]\s+/, ""))}</li>`)
  .join("");
const main = files.find((f) => f.arch === "x64") ?? files[0];
fs.writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Playnest</title>
<style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;color:#e8f1ff;background:radial-gradient(80% 60% at 20% 0%,#1b4fb8,transparent 70%),linear-gradient(#0c2a66,#030a1f)}
main{max-width:30rem;padding:2rem 1.25rem}h1{margin:0;font-size:2rem}p{color:#a9c4ee}
a.btn{display:inline-block;margin:1rem 0;padding:.8rem 1.4rem;border-radius:999px;color:#fff;text-decoration:none;font-weight:600;background:linear-gradient(#4d97ff,#1f58d0);box-shadow:inset 0 -3px 6px #6ee1ff88}
ul{color:#c8dbf7;padding-left:1.2rem}small{color:#7f9bc8}
</style></head><body><main>
<h1>Playnest ${esc(version)}</h1>
<p>Our music player for Windows. After installing, it updates itself.</p>
<a class="btn" href="${encodeURIComponent(main.name)}" download>Download for Windows</a>
<p><small>Windows may say "Windows protected your PC": click <b>More info</b>, then <b>Run anyway</b>.</small></p>
<h2>What's new</h2><ul>${noteItems}</ul>
</main></body></html>
`
);

console.log(`
✔ Playnest ${version} is ready in:  ${out}
    ${files.map((f) => f.name).join("\n    ")}
    latest.json
    index.html (a download page for first installs: ${base})

Now publish it: open your site on app.netlify.com → Deploys, and drag the
"release" folder onto the page. Installed copies will offer the update
within about 12 hours, or right away with Settings → Check for updates.
`);
