// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod relay;

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use relay::{Relay, Source};
use tauri_plugin_dialog::DialogExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::process::Command;

/// Event the frontend listens to for playback actions coming from outside
/// the webview (system tray menu, global hotkeys). Payload is one of
/// "toggle", "next", "previous".
const PLAYER_ACTION_EVENT: &str = "playnest://player-action";

/// Every yt-dlp call goes through here. It runs Playnest's own copy when
/// there is one (see engine.rs), else the one on PATH. A Windows GUI app
/// that launches a console program gets a black console window flashing up
/// each time unless it asks for no window, which the release build would
/// otherwise do on every search and every track.
pub(crate) fn ytdlp() -> Command {
    let mut cmd = Command::new(engine::program());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // If a request is abandoned, don't leave yt-dlp running in the background.
    cmd.kill_on_drop(true);
    cmd
}

// Replace with your own Discord application's Client ID — see README for
// how to create one. Rich presence silently no-ops without it.
const DISCORD_CLIENT_ID: &str = "YOUR_DISCORD_CLIENT_ID";

struct DiscordState(Mutex<Option<DiscordIpcClient>>);

/// The local audio relay, if it managed to start.
struct RelayState(Option<Relay>);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Track {
    id: String,
    title: String,
    uploader: String,
    #[serde(rename = "durationSeconds")]
    duration_seconds: f64,
    thumbnail: String,
}

// Raw shape of one line of `yt-dlp --flat-playlist -j` output.
// yt-dlp's JSON is inconsistent across versions, so most fields are optional.
#[derive(Debug, Deserialize)]
struct RawEntry {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
}

/// Search public sources (via yt-dlp's ytsearch) for tracks matching
/// `query`. `offset`/`limit` page through results for "Load more".
#[tauri::command]
async fn search_tracks(
    query: String,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<Track>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let offset = offset.unwrap_or(0).min(200);
    let limit = limit.unwrap_or(15).clamp(1, 50);
    let search_term = format!("ytsearch{}:{query}", offset + limit);
    let items = format!("{}:{}", offset + 1, offset + limit);

    let output = ytdlp()
        .args([
            "--flat-playlist",
            "--no-warnings",
            "-j",
            "--playlist-items",
            &items,
            &search_term,
        ])
        .output()
        .await
        .map_err(|e| format!("failed to run yt-dlp (is it installed and on PATH?): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp search failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut tracks = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<RawEntry>(line) else {
            continue;
        };
        let (Some(id), Some(title)) = (entry.id, entry.title) else {
            continue;
        };

        tracks.push(Track {
            thumbnail: format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"),
            uploader: entry.uploader.or(entry.channel).unwrap_or_default(),
            duration_seconds: entry.duration.unwrap_or(0.0),
            id,
            title,
        });
    }

    Ok(tracks)
}

/// Resolve a playable direct-audio stream URL for a given video id.
#[tauri::command]
async fn get_stream_url(video_id: String) -> Result<String, String> {
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let output = ytdlp()
        .args(["-f", "bestaudio", "--no-warnings", "-g", &watch_url])
        .output()
        .await
        .map_err(|e| format!("failed to run yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp stream resolution failed: {stderr}"));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if url.is_empty() {
        return Err("yt-dlp returned no stream URL".to_string());
    }

    Ok(url)
}

#[derive(Debug, Serialize)]
pub struct StreamSource {
    url: String,
    /// True when the URL goes through the local relay, meaning the webview
    /// may analyse the audio (visualizer, EQ, levelling).
    relayed: bool,
}

/// Resolve a track to a playable URL, routed through the relay when it's
/// running.
#[tauri::command]
async fn resolve_stream(video_id: String, relay: tauri::State<'_, RelayState>) -> Result<StreamSource, String> {
    let url = get_stream_url(video_id).await?;
    Ok(match relay.0.as_ref() {
        Some(relay) => StreamSource { url: relay.register(Source::Remote(url)), relayed: true },
        None => StreamSource { url, relayed: false },
    })
}

/// Serve a downloaded file through the relay. Only files inside the
/// downloads folder are accepted. Returns `relayed: false` (and no URL) if
/// the relay isn't running, so the frontend can fall back.
#[tauri::command]
fn relay_local_file(
    app: tauri::AppHandle,
    file_path: String,
    relay: tauri::State<'_, RelayState>,
) -> Result<StreamSource, String> {
    let dir = downloads_dir(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let target = PathBuf::from(&file_path)
        .canonicalize()
        .map_err(|_| "downloaded file is missing".to_string())?;
    if !target.starts_with(&dir) {
        return Err("refusing to serve a file outside the downloads folder".to_string());
    }
    Ok(match relay.0.as_ref() {
        Some(relay) => StreamSource { url: relay.register(Source::Local(target)), relayed: true },
        None => StreamSource { url: String::new(), relayed: false },
    })
}

#[tauri::command]
fn relay_available(relay: tauri::State<'_, RelayState>) -> bool {
    relay.0.is_some()
}

/// Largest backup file we'll read back in (a huge library is still only a
/// few MB of JSON).
const MAX_BACKUP_BYTES: u64 = 100 * 1024 * 1024;

/// Ask where to save, then write the backup. Returns the chosen path, or
/// None if the user cancelled.
#[tauri::command]
async fn save_backup(app: tauri::AppHandle, contents: String, suggested_name: String) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Playnest backup", &["json"])
        .set_file_name(suggested_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| format!("couldn't write the backup: {e}"))?;
    Ok(Some(path.display().to_string()))
}

/// Let the user pick a backup file and return its contents, or None if
/// they cancelled.
#[tauri::command]
async fn open_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Playnest backup", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_BACKUP_BYTES {
        return Err("That file is too large to be a Playnest backup.".to_string());
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("couldn't read that file: {e}"))
}

/// Push the currently playing track to Discord as Rich Presence. Silently
/// does nothing if Discord isn't running — this should never interrupt
/// playback.
#[tauri::command]
fn update_discord_presence(
    title: String,
    artist: String,
    is_playing: bool,
    start_timestamp: i64,
    discord: tauri::State<DiscordState>,
) -> Result<(), String> {
    let mut guard = discord.0.lock().map_err(|e| e.to_string())?;

    if guard.is_none() {
        let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID);
        if client.connect().is_err() {
            // Discord desktop app isn't running — not an error, just skip.
            return Ok(());
        }
        *guard = Some(client);
    }

    let Some(client) = guard.as_mut() else {
        return Ok(());
    };

    let state_text = if is_playing {
        artist
    } else {
        format!("{artist} · Paused")
    };

    let assets = activity::Assets::new()
        .large_image("playnest_logo")
        .large_text("Playnest");

    let mut act = activity::Activity::new()
        .details(&title)
        .state(&state_text)
        .assets(assets);

    if is_playing {
        act = act.timestamps(activity::Timestamps::new().start(start_timestamp));
    }

    if client.set_activity(act).is_err() {
        // Connection likely dropped (Discord closed mid-session) — clear so
        // the next update attempts a fresh reconnect instead of erroring.
        *guard = None;
    }

    Ok(())
}

#[tauri::command]
fn clear_discord_presence(discord: tauri::State<DiscordState>) -> Result<(), String> {
    let mut guard = discord.0.lock().map_err(|e| e.to_string())?;
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct LyricsResponse {
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    /// Length of the recording these lyrics were timed against, so the UI
    /// can warn when it differs from the track actually playing.
    #[serde(rename = "sourceDuration")]
    source_duration: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct LrcLibEntry {
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    duration: Option<f64>,
}

/// Pick the best lyrics from lrclib's search results: synced lyrics beat
/// plain ones, and among those the version whose length is closest to the
/// track being played wins. The first result is often a live version or
/// remix with completely different timing.
fn best_lyrics_match(results: Vec<LrcLibEntry>, duration: Option<f64>) -> Option<LrcLibEntry> {
    let has_synced = |e: &LrcLibEntry| e.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty());
    let distance = |e: &LrcLibEntry| match (duration, e.duration) {
        (Some(want), Some(have)) if want > 0.0 => (want - have).abs(),
        _ => f64::MAX / 2.0,
    };

    results.into_iter().min_by(|a, b| {
        has_synced(b)
            .cmp(&has_synced(a))
            .then(distance(a).partial_cmp(&distance(b)).unwrap_or(std::cmp::Ordering::Equal))
    })
}

/// Look up lyrics via lrclib.net's public search API (community-sourced,
/// no API key required). `duration` is the playing track's length in
/// seconds, used to pick the matching version.
#[tauri::command]
async fn get_lyrics(title: String, artist: String, duration: Option<f64>) -> Result<LyricsResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("playnest (https://github.com/yourname/playnest)")
        .build()
        .map_err(|e| e.to_string())?;

    let results: Vec<LrcLibEntry> = client
        .get("https://lrclib.net/api/search")
        .query(&[("track_name", title.as_str()), ("artist_name", artist.as_str())])
        .send()
        .await
        .map_err(|e| format!("lyrics request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("lyrics response was not valid JSON: {e}"))?;

    Ok(match best_lyrics_match(results, duration) {
        Some(entry) => LyricsResponse {
            synced_lyrics: entry.synced_lyrics,
            plain_lyrics: entry.plain_lyrics,
            source_duration: entry.duration,
        },
        None => LyricsResponse {
            synced_lyrics: None,
            plain_lyrics: None,
            source_duration: None,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(synced: bool, duration: f64) -> LrcLibEntry {
        LrcLibEntry {
            synced_lyrics: synced.then(|| format!("[00:01.00]{duration}")),
            plain_lyrics: Some("plain".into()),
            duration: Some(duration),
        }
    }

    #[test]
    fn picks_closest_synced_version() {
        let results = vec![entry(true, 400.0), entry(false, 273.0), entry(true, 270.0), entry(true, 300.0)];
        let best = best_lyrics_match(results, Some(273.0)).unwrap();
        assert_eq!(best.duration, Some(270.0));
    }

    #[test]
    fn falls_back_to_plain_when_nothing_synced() {
        let best = best_lyrics_match(vec![entry(false, 200.0)], Some(273.0)).unwrap();
        assert!(best.synced_lyrics.is_none());
    }

    #[test]
    fn explains_pip_and_permission_failures() {
        assert!(explain_update_failure("ERROR: You installed yt-dlp with pip or using the wheel from PyPi").contains("pip install -U"));
        assert!(explain_update_failure("ERROR: Unable to write to C:\\Windows\\yt-dlp.exe; Permission denied").contains("admin rights"));
        assert!(explain_update_failure("some\nother problem\n").contains("other problem"));
    }

    #[test]
    fn without_duration_prefers_synced() {
        let results = vec![entry(false, 200.0), entry(true, 500.0)];
        let best = best_lyrics_match(results, None).unwrap();
        assert!(best.synced_lyrics.is_some());
    }
}

/// The installed yt-dlp version, e.g. "2026.09.20".
#[tauri::command]
async fn ytdlp_version() -> Result<String, String> {
    let output = ytdlp()
        .arg("--version")
        .output()
        .await
        .map_err(|e| format!("yt-dlp isn't installed yet ({e})"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[derive(Debug, Serialize)]
pub struct YtdlpUpdateResult {
    updated: bool,
    version: String,
    message: String,
}

/// Turn yt-dlp's self-update failures into something actionable.
fn explain_update_failure(text: &str) -> String {
    let lower = text.to_lowercase();
    if lower.contains("pip") || lower.contains("pypi") {
        return "yt-dlp was installed with pip, so it can't update itself. Run `pip install -U yt-dlp` in a terminal instead.".to_string();
    }
    if lower.contains("permission") || lower.contains("access is denied") || lower.contains("errno 13") {
        return "yt-dlp is in a folder that needs admin rights to change (like C:\\Windows). Move yt-dlp.exe to a folder you own, such as C:\\tools, add that folder to PATH, and try again.".to_string();
    }
    if lower.contains("package manager") || lower.contains("winget") || lower.contains("scoop") || lower.contains("brew") {
        return format!("yt-dlp was installed with a package manager, so update it there. yt-dlp said: {}", last_line(text));
    }
    format!("Update failed: {}", last_line(text))
}

fn last_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .last()
        .unwrap_or("no output")
        .to_string()
}

#[derive(Debug, Serialize)]
pub struct YtdlpStatus {
    /// yt-dlp runs (Playnest's own copy, or one on PATH).
    available: bool,
    /// Playnest's own copy is the one in use.
    managed: bool,
    version: Option<String>,
}

#[tauri::command]
async fn ytdlp_status() -> YtdlpStatus {
    let version = ytdlp_version().await.ok();
    YtdlpStatus {
        available: version.is_some(),
        managed: engine::managed_installed(),
        version,
    }
}

/// Download Playnest's own copy of yt-dlp (first launch, or a repair).
/// Progress arrives as "playnest://ytdlp-progress" events.
#[tauri::command]
async fn install_ytdlp(app: tauri::AppHandle) -> Result<String, String> {
    engine::install(&app).await?;
    ytdlp_version().await
}

/// Update yt-dlp. Playnest's own copy updates itself; if it's still using
/// one from PATH (which, installed with pip or a package manager, often
/// can't self-update), this switches to its own, latest copy instead.
/// YouTube changes often break older versions, so this is the usual fix
/// when search or playback stops working.
#[tauri::command]
async fn update_ytdlp(app: tauri::AppHandle) -> Result<YtdlpUpdateResult, String> {
    if !engine::managed_installed() {
        let before = ytdlp_version().await.ok();
        engine::install(&app).await?;
        let version = ytdlp_version().await?;
        return Ok(YtdlpUpdateResult {
            updated: before.as_deref() != Some(version.as_str()),
            message: format!(
                "Playnest now uses its own copy of yt-dlp ({version}), which updates itself automatically every day."
            ),
            version,
        });
    }

    let before = ytdlp_version().await?;
    let output = ytdlp()
        .arg("-U")
        .output()
        .await
        .map_err(|e| format!("failed to run yt-dlp: {e}"))?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if !output.status.success() {
        return Err(explain_update_failure(&text));
    }

    let after = ytdlp_version().await.unwrap_or_else(|_| before.clone());
    Ok(YtdlpUpdateResult {
        updated: after != before,
        message: if after != before {
            format!("Updated yt-dlp from {before} to {after}.")
        } else {
            format!("yt-dlp is already up to date ({after}).")
        },
        version: after,
    })
}

#[derive(Debug, Serialize)]
pub struct ImportedPlaylist {
    title: String,
    tracks: Vec<Track>,
}

#[derive(Debug, Deserialize)]
struct RawPlaylist {
    title: Option<String>,
    entries: Option<Vec<RawEntry>>,
}

/// Read a YouTube (or YouTube Music) playlist link and return its title and
/// tracks. The frontend turns the result into a normal local playlist.
#[tauri::command]
async fn import_playlist(url: String) -> Result<ImportedPlaylist, String> {
    let url = url.trim().to_string();
    // Only accept real links, so nothing that looks like a yt-dlp option
    // (e.g. "--exec ...") can be smuggled in through this box.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Paste a full playlist link (starting with https://).".to_string());
    }

    let output = ytdlp()
        .args(["--flat-playlist", "--no-warnings", "-J", "--", &url])
        .output()
        .await
        .map_err(|e| format!("failed to run yt-dlp (is it installed and on PATH?): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Couldn't read that playlist: {stderr}"));
    }

    let raw: RawPlaylist = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Unexpected response from yt-dlp: {e}"))?;

    let tracks: Vec<Track> = raw
        .entries
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let id = entry.id?;
            let title = entry.title?;
            // Unavailable entries show up with placeholder titles.
            if title == "[Private video]" || title == "[Deleted video]" {
                return None;
            }
            Some(Track {
                thumbnail: format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"),
                uploader: entry.uploader.or(entry.channel).unwrap_or_default(),
                duration_seconds: entry.duration.unwrap_or(0.0),
                id,
                title,
            })
        })
        .collect();

    if tracks.is_empty() {
        return Err("That link didn't contain any playable tracks.".to_string());
    }

    Ok(ImportedPlaylist {
        title: raw.title.unwrap_or_else(|| "Imported playlist".to_string()),
        tracks,
    })
}

fn downloads_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("couldn't locate app data folder: {e}"))?
        .join("downloads");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create downloads folder: {e}"))?;
    Ok(dir)
}

fn is_valid_video_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Save a track's audio into the app's downloads folder for offline play.
/// Returns the absolute path of the saved file.
#[tauri::command]
async fn download_track(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    if !is_valid_video_id(&video_id) {
        return Err("invalid track id".to_string());
    }

    let dir = downloads_dir(&app)?;
    let template = dir.join("%(id)s.%(ext)s");
    let template = template.to_string_lossy().to_string();
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let output = ytdlp()
        .args([
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "--no-playlist",
            "--no-warnings",
            "--no-simulate",
            "-o",
            &template,
            "--print",
            "after_move:filepath",
            "--",
            &watch_url,
        ])
        .output()
        .await
        .map_err(|e| format!("failed to run yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .last()
        .ok_or("yt-dlp didn't report where it saved the file")?
        .to_string();

    if !PathBuf::from(&path).exists() {
        return Err("Download finished but the file wasn't found.".to_string());
    }

    Ok(path)
}

/// Delete a downloaded file. Refuses anything outside the downloads folder.
#[tauri::command]
fn delete_download(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let dir = downloads_dir(&app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = match PathBuf::from(&file_path).canonicalize() {
        Ok(p) => p,
        // Already gone — nothing to delete.
        Err(_) => return Ok(()),
    };
    if !target.starts_with(&dir) {
        return Err("refusing to delete a file outside the downloads folder".to_string());
    }
    std::fs::remove_file(&target).map_err(|e| format!("couldn't delete file: {e}"))
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_player_action(app: &tauri::AppHandle, action: &str) {
    let _ = app.emit(PLAYER_ACTION_EVENT, action);
}

/// Global hotkeys: Ctrl+Alt+Space (play/pause), Ctrl+Alt+Right (next),
/// Ctrl+Alt+Left (previous). They work even when Playnest isn't focused.
fn hotkey_mods() -> Modifiers {
    Modifiers::CONTROL | Modifiers::ALT
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Show Playnest", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &previous, &next, &separator, &show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("playnest-tray")
        .tooltip("Playnest")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" | "next" | "previous" => emit_player_action(app, event.id().as_ref()),
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn migrations() -> Vec<Migration> {
    // IMPORTANT: never edit the SQL of an existing migration, not even its
    // whitespace/indentation. The SQL plugin stores a checksum of each
    // applied migration and refuses to open the database if an
    // already-applied one changes. Add a new version instead.
    vec![Migration {
        version: 1,
        description: "create playlists, playlist_tracks, app_state",
        sql: "
            CREATE TABLE playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE playlist_tracks (
                playlist_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                track_id TEXT NOT NULL,
                title TEXT NOT NULL,
                uploader TEXT NOT NULL,
                duration_seconds REAL NOT NULL,
                thumbnail TEXT NOT NULL,
                PRIMARY KEY (playlist_id, position),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );

            CREATE TABLE app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "create recently_played",
        sql: "
            CREATE TABLE recently_played (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id TEXT NOT NULL,
                title TEXT NOT NULL,
                uploader TEXT NOT NULL,
                duration_seconds REAL NOT NULL,
                thumbnail TEXT NOT NULL,
                played_at TEXT NOT NULL
            );

            CREATE INDEX idx_recently_played_played_at ON recently_played (played_at);
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "create search_history",
        sql: "
            CREATE TABLE search_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                searched_at TEXT NOT NULL
            );

            CREATE INDEX idx_search_history_searched_at ON search_history (searched_at);
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "create liked_tracks and downloads",
        sql: "
            CREATE TABLE liked_tracks (
                track_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                uploader TEXT NOT NULL,
                duration_seconds REAL NOT NULL,
                thumbnail TEXT NOT NULL,
                liked_at TEXT NOT NULL
            );

            CREATE TABLE downloads (
                track_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                uploader TEXT NOT NULL,
                duration_seconds REAL NOT NULL,
                thumbnail TEXT NOT NULL,
                file_path TEXT NOT NULL,
                downloaded_at TEXT NOT NULL
            );
        ",
        kind: MigrationKind::Up,
    }]
}

fn main() {
    let relay = match Relay::start() {
        Ok(relay) => Some(relay),
        Err(err) => {
            eprintln!("audio relay unavailable, visualizer/EQ will be off: {err}");
            None
        }
    };

    tauri::Builder::default()
        .manage(DiscordState(Mutex::new(None)))
        .manage(RelayState(relay))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:playnest.db", migrations())
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let mods = hotkey_mods();
                    let action = if shortcut.matches(mods, Code::Space) {
                        "toggle"
                    } else if shortcut.matches(mods, Code::ArrowRight) {
                        "next"
                    } else if shortcut.matches(mods, Code::ArrowLeft) {
                        "previous"
                    } else {
                        return;
                    };
                    emit_player_action(app, action);
                })
                .build(),
        )
        .setup(|app| {
            engine::init(app.handle());
            engine::spawn_auto_update();

            // A hotkey another app already owns shouldn't stop Playnest
            // from starting — just log it and carry on without that one.
            for code in [Code::Space, Code::ArrowRight, Code::ArrowLeft] {
                let shortcut = Shortcut::new(Some(hotkey_mods()), code);
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    eprintln!("could not register global hotkey {code:?}: {err}");
                }
            }

            // Same for the tray: a desktop without tray support shouldn't
            // stop the app from opening.
            if let Err(err) = setup_tray(app) {
                eprintln!("could not create tray icon: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_tracks,
            get_stream_url,
            update_discord_presence,
            clear_discord_presence,
            get_lyrics,
            import_playlist,
            download_track,
            delete_download,
            ytdlp_version,
            ytdlp_status,
            install_ytdlp,
            update_ytdlp,
            resolve_stream,
            relay_local_file,
            relay_available,
            save_backup,
            open_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running Playnest");
}
