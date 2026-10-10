import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** Thin, failure-proof wrappers around the native window. Outside Tauri
 * (e.g. a browser preview) they do nothing; inside, a failed call is only
 * logged, since window chrome must never break playback. */

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function run<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  if (!inTauri()) return null;
  try {
    return await fn();
  } catch (err) {
    console.warn(`Window: couldn't ${what}`, err);
    return null;
  }
}

export interface WindowSize {
  width: number;
  height: number;
}

/** Current inner size in logical (CSS) pixels. */
export function getWindowSize(): Promise<WindowSize | null> {
  return run("read its size", async () => {
    const win = getCurrentWindow();
    const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
    return { width: Math.round(size.width / scale), height: Math.round(size.height / scale) };
  });
}

export function setWindowSize(width: number, height: number) {
  return run("resize", () => getCurrentWindow().setSize(new LogicalSize(width, height)));
}

export function setWindowMinSize(width: number, height: number) {
  return run("set its minimum size", () => getCurrentWindow().setMinSize(new LogicalSize(width, height)));
}

export function setWindowDecorations(decorated: boolean) {
  return run("change its frame", () => getCurrentWindow().setDecorations(decorated));
}

export function minimizeWindow() {
  return run("minimize", () => getCurrentWindow().minimize());
}

export function closeWindow() {
  return run("close", () => getCurrentWindow().close());
}
