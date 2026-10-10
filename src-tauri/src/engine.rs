//! Playnest's own copy of yt-dlp.
//!
//! So the app works on a PC with nothing else installed, Playnest downloads
//! the official standalone yt-dlp build from its GitHub releases into the
//! app's data folder, verifies it against the release's published SHA-256
//! checksums, and keeps it updated. If there's no copy of its own yet, a
//! `yt-dlp` on PATH is used instead (handy while developing).

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const RELEASE_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
pub const PROGRESS_EVENT: &str = "playnest://ytdlp-progress";
/// How often the background updater runs `yt-dlp -U`.
const AUTO_UPDATE_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// The release asset for this platform (a single self-contained executable).
pub const ASSET: &str = if cfg!(all(windows, target_arch = "aarch64")) {
    "yt-dlp_arm64.exe"
} else if cfg!(windows) {
    "yt-dlp.exe"
} else if cfg!(target_os = "macos") {
    "yt-dlp_macos"
} else if cfg!(target_arch = "aarch64") {
    "yt-dlp_linux_aarch64"
} else {
    "yt-dlp_linux"
};

static MANAGED_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Work out where Playnest's copy lives. Call once at startup.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = MANAGED_PATH.set(dir.join("bin").join(ASSET));
    }
}

fn managed_path() -> Option<&'static PathBuf> {
    MANAGED_PATH.get()
}

pub fn managed_installed() -> bool {
    managed_path().is_some_and(|p| p.is_file())
}

/// The program to run: Playnest's own copy when present, else PATH.
pub fn program() -> PathBuf {
    match managed_path() {
        Some(p) if p.is_file() => p.clone(),
        _ => PathBuf::from("yt-dlp"),
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Find `asset`'s hash in a `SHA2-256SUMS` file ("<hash>  <name>" lines).
fn expected_hash(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn net_error(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "Couldn't reach GitHub to download yt-dlp. Check the internet connection and try again.".to_string()
    } else {
        format!("Downloading yt-dlp failed: {e}")
    }
}

fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(concat!("Playnest/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
}

/// Download the latest yt-dlp into `dest`, verified against the release's
/// checksums. Reports progress through `on_progress`.
pub async fn download_verified(
    client: &reqwest::Client,
    dest: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let dir = dest.parent().ok_or("bad destination")?;
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;

    let sums = client
        .get(format!("{RELEASE_BASE}/SHA2-256SUMS"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(net_error)?
        .text()
        .await
        .map_err(net_error)?;
    let expected = expected_hash(&sums, ASSET)
        .ok_or_else(|| format!("The yt-dlp release doesn't list a checksum for {ASSET}."))?;

    let mut response = client
        .get(format!("{RELEASE_BASE}/{ASSET}"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(net_error)?;
    let total = response.content_length();

    let tmp = dir.join(format!("{ASSET}.download"));
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("Couldn't write {}: {e}", tmp.display()))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut reported = 0u64;
    on_progress(0, total);

    let result: Result<(), String> = async {
        while let Some(chunk) = response.chunk().await.map_err(net_error)? {
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            if downloaded - reported >= 256 * 1024 {
                reported = downloaded;
                on_progress(downloaded, total);
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    on_progress(downloaded, total);

    let actual = to_hex(&hasher.finalize());
    if actual != expected {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err("The downloaded yt-dlp didn't match its published checksum, so it was discarded. Try again in a moment.".to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
            .await
            .map_err(|e| e.to_string())?;
    }

    // Windows won't rename over an existing file.
    if dest.exists() {
        tokio::fs::remove_file(dest).await.map_err(|e| {
            format!("Couldn't replace the old yt-dlp (is a search or download still running?): {e}")
        })?;
    }
    tokio::fs::rename(&tmp, dest)
        .await
        .map_err(|e| format!("Couldn't move yt-dlp into place: {e}"))?;
    Ok(())
}

/// Install (or reinstall) Playnest's own copy, emitting progress events.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let dest = managed_path()
        .ok_or("Playnest couldn't find its data folder.")?
        .clone();
    let app = app.clone();
    let client = client_builder().build().map_err(|e| e.to_string())?;
    download_verified(&client, &dest, move |downloaded, total| {
        let _ = app.emit(PROGRESS_EVENT, Progress { downloaded, total });
    })
    .await?;
    touch_update_stamp();
    Ok(())
}

fn update_stamp() -> Option<PathBuf> {
    managed_path().and_then(|p| p.parent()).map(|d| d.join("last-update-check"))
}

fn touch_update_stamp() {
    if let Some(stamp) = update_stamp() {
        let _ = std::fs::write(stamp, b"");
    }
}

fn update_due() -> bool {
    let Some(stamp) = update_stamp() else { return false };
    match std::fs::metadata(stamp).and_then(|m| m.modified()) {
        Ok(modified) => SystemTime::now()
            .duration_since(modified)
            .map_or(true, |age| age >= AUTO_UPDATE_EVERY),
        Err(_) => true,
    }
}

/// Once a day, quietly let Playnest's copy update itself: YouTube changes
/// break older versions, and family members won't press "update".
pub fn spawn_auto_update() {
    if !managed_installed() || !update_due() {
        return;
    }
    tauri::async_runtime::spawn(async {
        let result = crate::ytdlp().arg("-U").output().await;
        match result {
            Ok(out) if out.status.success() => touch_update_stamp(),
            Ok(out) => eprintln!("yt-dlp auto-update failed: {}", String::from_utf8_lossy(&out.stderr)),
            Err(e) => eprintln!("yt-dlp auto-update failed to start: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_right_hash() {
        let sums = "\
1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6  yt-dlp
66674953FE251B89F4D08C5F0E35E0728679BD67AB3D7D05C0562AF101DD3E7A  yt-dlp.exe
05b438997bafc3affdfda9d041353c9d73e04dc842207254b655b0887c4445b0 *yt-dlp_arm64.exe
nothex  yt-dlp_linux";
        assert_eq!(
            expected_hash(sums, "yt-dlp.exe").as_deref(),
            Some("66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a")
        );
        assert!(expected_hash(sums, "yt-dlp_arm64.exe").is_some());
        assert_eq!(expected_hash(sums, "yt-dlp_linux"), None);
        assert_eq!(expected_hash(sums, "yt-dlp.tar.gz"), None);
    }

    #[test]
    fn hex_encodes() {
        assert_eq!(to_hex(&[0x00, 0xab, 0xff]), "00abff");
    }

    /// Real download from GitHub. Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn downloads_and_verifies_latest_release() {
        let dir = std::env::temp_dir().join(format!("playnest-engine-test-{}", std::process::id()));
        let dest = dir.join(ASSET);
        // Behind an intercepting proxy (e.g. CI), trust its CA as well.
        let mut builder = client_builder();
        if let Ok(path) = std::env::var("PLAYNEST_TEST_EXTRA_CA") {
            let pem = std::fs::read(path).expect("read CA bundle");
            for cert in reqwest::Certificate::from_pem_bundle(&pem).expect("parse CA bundle") {
                builder = builder.add_root_certificate(cert);
            }
        }
        let client = builder.build().unwrap();
        let mut calls = 0;
        download_verified(&client, &dest, |_, _| calls += 1).await.expect("download");
        assert!(dest.is_file());
        assert!(calls >= 2);
        // The downloaded program actually runs.
        #[cfg(target_os = "linux")]
        {
            let out = std::process::Command::new(&dest).arg("--version").output().expect("run");
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            println!("downloaded yt-dlp {}", String::from_utf8_lossy(&out.stdout).trim());
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
