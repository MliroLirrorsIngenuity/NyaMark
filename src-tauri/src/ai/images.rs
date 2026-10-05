//! Images the assistant is shown, read here by path so the page can send
//! one a document refers to without reaching the file itself.

use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Window};
use tauri_plugin_fs::FsExt;

use super::{
    blocking,
    workspace::{self, error_code, is_remote_or_device, normalize_lexically},
};
use crate::{document, sessions};

/// Larger than any service takes; a bigger file is not worth reading.
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// The image type the bytes start like. The file name may say anything,
/// so only the bytes count.
pub fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 26 && bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

/// Where an image the page named lies by name alone: a relative path is
/// taken from `folder`. Shares and device paths are refused as written,
/// before anything on disk is asked about them.
fn lexical_target(folder: Option<&Path>, path: &str) -> Result<PathBuf, String> {
    if is_remote_or_device(path) {
        return Err("forbidden".into());
    }
    let target = Path::new(path);
    let target = if target.is_relative() {
        folder.ok_or_else(|| "not-found".to_string())?.join(target)
    } else {
        target.to_path_buf()
    };
    normalize_lexically(&target).ok_or_else(|| "forbidden".to_string())
}

fn image_for_ai(app: &AppHandle, window: &str, path: &str) -> Result<Vec<u8>, String> {
    let folder = sessions::assigned_window_file(app, window)
        .and_then(|file| Path::new(&file).parent().map(Path::to_path_buf));
    let target = lexical_target(folder.as_deref(), path)?;
    // The window's workspace, and the places the editor may open: home
    // without its key folders, and what the user opened or granted.
    let roots = workspace::roots(app, window);
    let allowed = |path: &Path| {
        roots
            .iter()
            .any(|root| workspace::within_lexically(root, path))
            || app.fs_scope().is_allowed(path)
    };
    if !allowed(&target) {
        return Err("forbidden".into());
    }
    let target = fs::canonicalize(&target).map_err(|_| "not-found".to_string())?;
    if !allowed(&target) {
        return Err("forbidden".into());
    }
    read_image(&target)
}

/// Read an image for the assistant. A relative path is taken from the
/// folder of the window's document, as the document's own links are.
#[tauri::command]
pub async fn read_image_for_ai(
    app: AppHandle,
    window: Window,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let label = window.label().to_string();
    blocking(move || image_for_ai(&app, &label, &path))
        .await
        .map(tauri::ipc::Response::new)
}

pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| "not-found".to_string())?;
    if !metadata.is_file() {
        return Err("not-found".into());
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("too-large".into());
    }
    let bytes = document::read_limited(path, MAX_IMAGE_BYTES).map_err(error_code)?;
    if image_kind(&bytes).is_none() {
        return Err("not-an-image".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_known_by_their_first_bytes() {
        let mut webp = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0; 8]);
        let mut bmp = b"BM".to_vec();
        bmp.extend_from_slice(&[0; 30]);
        for (bytes, kind) in [
            (b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec(), "image/png"),
            (vec![0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10], "image/jpeg"),
            (b"GIF89a\x01\0\x01\0".to_vec(), "image/gif"),
            (b"GIF87a\x01\0\x01\0".to_vec(), "image/gif"),
            (webp, "image/webp"),
            (bmp, "image/bmp"),
        ] {
            assert_eq!(image_kind(&bytes), Some(kind));
        }
        for bytes in [
            &b""[..],
            b"BM",
            b"RIFF\0\0\0\0WAVE",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            b"%PDF-1.7",
            b"\x89PNX",
        ] {
            assert_eq!(image_kind(bytes), None);
        }
    }

    #[test]
    fn only_a_real_image_file_is_read() {
        let folder = tempfile::tempdir().unwrap();
        let png = folder.path().join("a.png");
        fs::write(&png, b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR").unwrap();
        assert_eq!(read_image(&png).unwrap().len(), 16);
        let fake = folder.path().join("b.png");
        fs::write(&fake, b"not an image").unwrap();
        assert_eq!(read_image(&fake), Err("not-an-image".into()));
        assert_eq!(read_image(folder.path()), Err("not-found".into()));
        assert_eq!(
            read_image(&folder.path().join("missing.png")),
            Err("not-found".into())
        );
        let big = folder.path().join("big.png");
        fs::File::create(&big)
            .unwrap()
            .set_len(MAX_IMAGE_BYTES + 1)
            .unwrap();
        assert_eq!(read_image(&big), Err("too-large".into()));
    }

    #[test]
    fn an_image_path_is_worked_out_by_name_first() {
        let folder = Path::new("/notes/doc");
        for path in [
            r"\\evil\s\a.png",
            "//evil/s/a.png",
            r"\\?\UNC\evil\s\a.png",
            r"\\.\pipe\x",
            r"\??\UNC\evil\s\a.png",
        ] {
            assert_eq!(
                lexical_target(Some(folder), path),
                Err("forbidden".into()),
                "{path}"
            );
        }
        assert_eq!(lexical_target(None, "a.png"), Err("not-found".into()));
        assert_eq!(
            lexical_target(Some(folder), "img/./a.png"),
            Ok(PathBuf::from("/notes/doc/img/a.png"))
        );
        assert_eq!(
            lexical_target(Some(folder), "../shared/a.png"),
            Ok(PathBuf::from("/notes/shared/a.png"))
        );
        assert_eq!(
            lexical_target(Some(folder), "../../../../a.png"),
            Err("forbidden".into())
        );
    }
}
