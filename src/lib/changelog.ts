import raw from "../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  version: string;
  date: string | null;
  /** The section's lines, as written (bullets start with "- "). */
  lines: string[];
}

/** Sections of CHANGELOG.md: "## 1.2.3 - 2026-09-27" followed by lines. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+v?(\d+\.\d+\.\d+[^\s]*)\s*(?:[-–—]\s*(.+))?$/);
    if (heading) {
      current = { version: heading[1], date: heading[2]?.trim() || null, lines: [] };
      entries.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  for (const entry of entries) {
    while (entry.lines.length && !entry.lines[0].trim()) entry.lines.shift();
    while (entry.lines.length && !entry.lines[entry.lines.length - 1].trim()) entry.lines.pop();
  }
  return entries;
}

export const CHANGELOG = parseChangelog(raw);

export function changelogFor(version: string): ChangelogEntry | null {
  return CHANGELOG.find((e) => e.version === version) ?? null;
}
