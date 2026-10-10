import { loadAppState, saveAppState } from "./db";

export interface Settings {
  /** Keep playing similar tracks when the queue runs out. */
  autoplay: boolean;
  /** Seconds to blend between tracks; 0 turns crossfade off. */
  crossfadeSeconds: number;
  /** Hide hour-long mixes, full concerts and live streams from search. */
  songsOnly: boolean;
  eqEnabled: boolean;
  /** A key of EQ_PRESETS, or "Custom". */
  eqPreset: string;
  /** dB per band, matching EQ_FREQUENCIES. */
  eqGains: number[];
  /** Even out loudness between tracks. */
  levelling: boolean;
  /** Extra gain (dB) before the equalizer, like a classic EQ's preamp. */
  eqPreamp: number;
  /** Classic skinned player (compact stack) or the modern sidebar layout. */
  layout: Layout;
  /** Colour scheme for the classic layout. */
  skin: Skin;
}

export type Layout = "classic" | "modern";
export type Skin = "y2k" | "green" | "black" | "midnight";
export const SKINS: { id: Skin; name: string }[] = [
  { id: "y2k", name: "Y2K chrome" },
  { id: "green", name: "Classic green" },
  { id: "black", name: "Black & green" },
  { id: "midnight", name: "Midnight blue" },
];

export const DEFAULT_SETTINGS: Settings = {
  autoplay: true,
  crossfadeSeconds: 0,
  songsOnly: false,
  eqEnabled: false,
  eqPreset: "Flat",
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  levelling: false,
  eqPreamp: 0,
  layout: "classic",
  skin: "y2k",
};

export const CROSSFADE_OPTIONS = [0, 2, 4, 6, 8, 12];

export async function loadSettings(): Promise<Settings> {
  const saved = await loadAppState<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await saveAppState("settings", settings);
}
