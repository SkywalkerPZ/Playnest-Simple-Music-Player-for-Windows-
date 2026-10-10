import { invoke } from "@tauri-apps/api/core";
import { Track } from "./types";

export async function updateDiscordPresence(
  track: Track,
  isPlaying: boolean,
  currentTime: number
): Promise<void> {
  const startTimestamp = Math.floor(Date.now() / 1000) - Math.floor(currentTime);
  try {
    await invoke("update_discord_presence", {
      title: track.title,
      artist: track.uploader,
      isPlaying,
      startTimestamp,
    });
  } catch (err) {
    console.warn("Discord presence update failed", err);
  }
}

export async function clearDiscordPresence(): Promise<void> {
  try {
    await invoke("clear_discord_presence");
  } catch (err) {
    console.warn("Discord presence clear failed", err);
  }
}
