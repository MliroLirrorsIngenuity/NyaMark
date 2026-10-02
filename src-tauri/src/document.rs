//! Reading and writing the markdown document a window edits.
//!
//! The webview never touches the document body through the fs plugin:
//!
//! - A read fails loudly when the bytes are not UTF-8. The plugin's
//!   `readTextFile` decodes lossily, and the U+FFFD replacements it produces
//!   would be written back over the original on the next save.
//! - A write goes through a temporary file in the same directory that is
//!   flushed and then renamed over the target, so a crash, a full disk or a
//!   power cut can never leave a truncated document behind.
//! - The byte order mark and the line ending style seen on read are restored
//!   on write, so a Windows file does not turn into a whole-file diff.

use std::{
    borrow::Cow,
    fs, io,
    io::{Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// Largest document the editor opens. ProseMirror slows to a crawl long
/// before this, and the cap keeps a stray multi-gigabyte file (a log renamed
/// to `.md`) from being pulled into memory and over IPC in one piece.
pub const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

/// Byte-level properties of a file that the editor itself never sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFormat {
    pub bom: bool,
    pub line_ending: LineEnding,
}

impl Default for DocumentFormat {
    fn default() -> Self {
        Self {
            bom: false,
            line_ending: LineEnding::Lf,
        }
    }
}

/// Text normalized to `\n` line endings plus the format needed to write it
/// back the way it was found.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocument {
    pub text: String,
    pub format: DocumentFormat,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DocumentError {
    /// The bytes are not valid UTF-8. `encoding` names the encoding when a
    /// byte order mark identified one; otherwise it is unknown.
    NotUtf8 {
        encoding: Option<&'static str>,
    },
    /// The path lies outside the filesystem scope granted to the webview.
    Forbidden,
    /// The file is larger than `MAX_DOCUMENT_BYTES`.
    TooLarge {
        limit_bytes: u64,
    },
    /// Nothing is at the path: the file was deleted, or moved away.
    Missing {
        message: String,
    },
    Io {
        message: String,
    },
}

impl From<io::Error> for DocumentError {
    fn from(error: io::Error) -> Self {
        let message = error.to_string();
        if error.kind() == io::ErrorKind::NotFound {
            Self::Missing { message }
        } else {
            Self::Io { message }
        }
    }
}

pub fn read<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
) -> Result<MarkdownDocument, DocumentError> {
    ensure_allowed(app, path)?;
    decode(read_limited(path, MAX_DOCUMENT_BYTES)?)
}

/// Read at most `limit` bytes. The size is checked on the bytes actually read
/// so a file that grows after a metadata check cannot slip past it.
fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, DocumentError> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(DocumentError::TooLarge { limit_bytes: limit });
    }
    Ok(bytes)
}

pub fn write<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    text: &str,
    format: DocumentFormat,
) -> Result<(), DocumentError> {
    ensure_allowed(app, path)?;
    write_atomically(path, &encode(text, format))?;
    Ok(())
}

/// Same runtime scope the fs plugin enforces: the static capability entries
/// plus everything `sessions::allow_document_scope` and the dialog plugin
/// granted, minus the deny list.
fn ensure_allowed<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), DocumentError> {
    if app.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err(DocumentError::Forbidden)
    }
}

pub fn decode(bytes: Vec<u8>) -> Result<MarkdownDocument, DocumentError> {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Err(DocumentError::NotUtf8 {
            encoding: Some("UTF-16 LE"),
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Err(DocumentError::NotUtf8 {
            encoding: Some("UTF-16 BE"),
        });
    }

    let mut text =
        String::from_utf8(bytes).map_err(|_| DocumentError::NotUtf8 { encoding: None })?;

    let bom = text.starts_with('\u{FEFF}');
    if bom {
        text.drain(..'\u{FEFF}'.len_utf8());
    }

    let line_ending = detect_line_ending(&text);
    if line_ending == LineEnding::Crlf {
        text = text.replace("\r\n", "\n");
    }

    Ok(MarkdownDocument {
        text,
        format: DocumentFormat { bom, line_ending },
    })
}

/// The first line break decides, the same rule editors such as VS Code use;
/// a file with mixed endings is unified on the next write.
fn detect_line_ending(text: &str) -> LineEnding {
    match text.find('\n') {
        Some(index) if index > 0 && text.as_bytes()[index - 1] == b'\r' => LineEnding::Crlf,
        _ => LineEnding::Lf,
    }
}

pub fn encode(text: &str, format: DocumentFormat) -> Vec<u8> {
    // The editor emits `\n`; anything else that slipped in is unified first.
    let normalized: Cow<str> = if text.contains("\r\n") {
        Cow::Owned(text.replace("\r\n", "\n"))
    } else {
        Cow::Borrowed(text)
    };

    let mut bytes = Vec::with_capacity(normalized.len() + UTF8_BOM.len());
    if format.bom {
        bytes.extend_from_slice(&UTF8_BOM);
    }
    match format.line_ending {
        LineEnding::Lf => bytes.extend_from_slice(normalized.as_bytes()),
        LineEnding::Crlf => {
            for segment in normalized.split_inclusive('\n') {
                match segment.strip_suffix('\n') {
                    Some(line) => {
                        bytes.extend_from_slice(line.as_bytes());
                        bytes.extend_from_slice(b"\r\n");
                    }
                    None => bytes.extend_from_slice(segment.as_bytes()),
                }
            }
        }
    }
    bytes
}

/// Replace `path` with `bytes` without ever exposing a partially written file.
///
/// The data goes to a hidden temporary file next to the target, is flushed to
/// disk, takes over the target's permissions and is then renamed into place.
/// Rename is atomic on every supported platform, so readers (and the file
/// watcher) only ever observe the old or the new content. Symlinks are
/// followed so the link itself survives and its target is replaced.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let directory = match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "document path has no parent directory",
            ))
        }
    };
    let file_name = target.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "document path has no file name",
        )
    })?;

    // A brand-new document is created empty first so it receives the
    // permissions the umask dictates; the temporary file below is always
    // created owner-only and copies whatever the target has.
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let permissions = fs::metadata(&target)?.permissions();

    let prefix = format!(".{}.", file_name.to_string_lossy());
    let mut temp = tempfile::Builder::new()
        .prefix(&prefix)
        .suffix(".tmp")
        .tempfile_in(directory)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.as_file().set_permissions(permissions)?;
    temp.persist(&target).map_err(|error| error.error)?;

    // The rename itself is durable only once the directory entry is flushed.
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(directory) {
        let _ = dir.sync_all();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn format(bom: bool, line_ending: LineEnding) -> DocumentFormat {
        DocumentFormat { bom, line_ending }
    }

    #[test]
    fn decodes_plain_utf8_as_lf_without_bom() {
        let document = decode(b"# Title\n\ntext\n".to_vec()).unwrap();
        assert_eq!(document.text, "# Title\n\ntext\n");
        assert_eq!(document.format, format(false, LineEnding::Lf));
    }

    #[test]
    fn strips_bom_and_normalizes_crlf() {
        let document = decode(b"\xEF\xBB\xBFline one\r\nline two\r\n".to_vec()).unwrap();
        assert_eq!(document.text, "line one\nline two\n");
        assert_eq!(document.format, format(true, LineEnding::Crlf));
    }

    #[test]
    fn first_line_break_decides_the_style() {
        let document = decode(b"a\nb\r\nc".to_vec()).unwrap();
        assert_eq!(document.format.line_ending, LineEnding::Lf);
        assert_eq!(document.text, "a\nb\r\nc");
    }

    #[test]
    fn rejects_invalid_utf8_instead_of_replacing_it() {
        // "中文" in GBK.
        let error = decode(vec![0xD6, 0xD0, 0xCE, 0xC4]).unwrap_err();
        assert!(matches!(error, DocumentError::NotUtf8 { encoding: None }));
    }

    #[test]
    fn names_utf16_from_its_bom() {
        let error = decode(vec![0xFF, 0xFE, 0x41, 0x00]).unwrap_err();
        assert!(matches!(
            error,
            DocumentError::NotUtf8 {
                encoding: Some("UTF-16 LE")
            }
        ));
    }

    #[test]
    fn encode_restores_bom_and_crlf() {
        let bytes = encode("one\ntwo\nlast", format(true, LineEnding::Crlf));
        assert_eq!(bytes, b"\xEF\xBB\xBFone\r\ntwo\r\nlast");
    }

    #[test]
    fn encode_unifies_stray_crlf_in_lf_mode() {
        let bytes = encode("one\r\ntwo\n", format(false, LineEnding::Lf));
        assert_eq!(bytes, b"one\ntwo\n");
    }

    #[test]
    fn round_trip_preserves_bytes() {
        let original = b"\xEF\xBB\xBF# T\r\n\r\nbody\r\n".to_vec();
        let document = decode(original.clone()).unwrap();
        assert_eq!(encode(&document.text, document.format), original);
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old").unwrap();

        write_atomically(&path, b"new content").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new content");
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("note.md")]);
    }

    #[test]
    fn read_limited_rejects_files_over_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.md");
        fs::write(&path, b"0123456789").unwrap();

        assert_eq!(read_limited(&path, 10).unwrap(), b"0123456789");
        assert!(matches!(
            read_limited(&path, 9).unwrap_err(),
            DocumentError::TooLarge { limit_bytes: 9 }
        ));
    }

    #[test]
    fn atomic_write_creates_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fresh.md");

        write_atomically(&path, b"hello").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

        write_atomically(&path, b"new").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
    }
}
