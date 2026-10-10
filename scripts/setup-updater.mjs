// One-time setup for Playnest's self-updates.
//
//   npm run updater:setup -- https://your-site.netlify.app
//
// Creates your signing key (if you don't have one yet) in your user folder,
// and writes the public half and your site's address into tauri.conf.json.
import fs from "node:fs";
import path from "node:path";
import { CONF_PATH, KEY_PATH, fail, readJson, tauri, writeJson } from "./shared.mjs";

const arg = process.argv[2];
if (!arg) fail("Give your update site's address, e.g.  npm run updater:setup -- https://playnest-abc123.netlify.app");

let site;
try {
  site = new URL(arg);
} catch {
  fail(`"${arg}" isn't a web address.`);
}
if (site.protocol !== "https:") fail("The update site must use https://");
const base = site.href.replace(/\/+$/, "").replace(/\/latest\.json$/, "");

if (fs.existsSync(KEY_PATH)) {
  console.log(`Using your existing signing key: ${KEY_PATH}`);
} else {
  console.log(`Creating your signing key: ${KEY_PATH}`);
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  if (!tauri(["signer", "generate", "--ci", "-p", "", "-w", KEY_PATH])) fail("Couldn't create the signing key.");
}

const pubPath = `${KEY_PATH}.pub`;
if (!fs.existsSync(pubPath)) fail(`The public key ${pubPath} is missing. It's created together with the private key.`);
const pubkey = fs.readFileSync(pubPath, "utf8").trim();

const conf = readJson(CONF_PATH);
conf.bundle = { ...conf.bundle, createUpdaterArtifacts: true };
conf.plugins = conf.plugins ?? {};
conf.plugins.updater = {
  ...conf.plugins.updater,
  pubkey,
  // Keep a GitHub releases address (if there is one) first.
  endpoints: [
    ...(conf.plugins.updater?.endpoints ?? []).filter((e) => e.includes("github.com")),
    `${base}/latest.json`,
  ],
  windows: { installMode: "passive", ...(conf.plugins.updater?.windows ?? {}) },
};
writeJson(CONF_PATH, conf);

console.log(`
✔ Updates are set up.
  Update site:  ${base}
  Signing key:  ${KEY_PATH}

IMPORTANT: back up ${KEY_PATH} (a USB stick, a password manager…).
Every copy of Playnest you install from now on only accepts updates signed
with this key. If you lose it, those copies can't be updated any more and
you'd have to reinstall them by hand.

Next: write what's new in CHANGELOG.md, then run  npm run release
`);
