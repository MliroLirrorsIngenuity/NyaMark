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
//! - A save names the version of the file it was based on and leaves alone a
//!   file another program wrote since, whether or not the file watcher saw
//!   that happen.

use std::{
    borrow::Cow,
    fs,
    hash::{DefaultHasher, Hasher},
    io,
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
    /// Names the bytes read, for a later write to check against.
    pub version: String,
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
    /// The file is marked read-only; a save leaves it as it is.
    ReadOnly,
    /// The file is larger than `MAX_DOCUMENT_BYTES`.
    TooLarge {
        limit_bytes: u64,
    },
    /// Nothing is at the path: the file was deleted, or moved away.
    Missing {
        message: String,
    },
    /// The file no longer holds the version a save was based on: another
    /// program wrote it since it was read or saved here.
    Changed,
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
pub(crate) fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, DocumentError> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(DocumentError::TooLarge { limit_bytes: limit });
    }
    Ok(bytes)
}

/// Writes the document and returns the version it wrote. Given the version
/// the document was based on, a file that holds anything else is left as it
/// is; one that is gone is written again, since nothing on disk is lost then.
pub fn write<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    text: &str,
    format: DocumentFormat,
    expected_version: Option<&str>,
) -> Result<String, DocumentError> {
    ensure_allowed(app, path)?;
    write_document(path, text, format, expected_version)
}

pub(crate) fn write_document(
    path: &Path,
    text: &str,
    format: DocumentFormat,
    expected_version: Option<&str>,
) -> Result<String, DocumentError> {
    // The rename below replaces a file whatever its own permissions say.
    if fs::metadata(path).is_ok_and(|metadata| metadata.permissions().readonly()) {
        return Err(DocumentError::ReadOnly);
    }
    if let Some(expected) = expected_version {
        match read_limited(path, MAX_DOCUMENT_BYTES) {
            Ok(bytes) if version_of(&bytes) == expected => {}
            Ok(_) | Err(DocumentError::TooLarge { .. }) => return Err(DocumentError::Changed),
            Err(DocumentError::Missing { .. }) => {}
            Err(error) => return Err(error),
        }
    }
    let bytes = encode(text, format);
    write_atomically(path, &bytes)?;
    Ok(version_of(&bytes))
}

/// The bytes' length and hash. Only ever compared within one run of the app,
/// so the hash may change between Rust releases.
pub(crate) fn version_of(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    format!("{}-{:016x}", bytes.len(), hasher.finish())
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
    let version = version_of(&bytes);
    if let Some((encoding, _)) = encoding_rs::Encoding::for_bom(&bytes) {
        if encoding != encoding_rs::UTF_8 {
            return Err(DocumentError::NotUtf8 {
                encoding: Some(encoding.name()),
            });
        }
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
        version,
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
    let created = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => false,
        Err(error) => return Err(error),
    };

    let result = replace_with_temp_file(&target, directory, file_name, bytes);
    // A write that failed leaves no empty file where it was to create one.
    if result.is_err() && created && fs::metadata(&target).is_ok_and(|metadata| metadata.len() == 0)
    {
        let _ = fs::remove_file(&target);
    }
    result
}

fn replace_with_temp_file(
    target: &Path,
    directory: &Path,
    file_name: &std::ffi::OsStr,
    bytes: &[u8],
) -> io::Result<()> {
    let permissions = fs::metadata(target)?.permissions();

    // Named after the document, cut short: the whole of a name near the
    // limit left no room for the rest, and the document could not be saved.
    let name = file_name.to_string_lossy();
    let prefix = format!(".{}.", name_start(&name, 64));
    let mut temp = tempfile::Builder::new()
        .prefix(&prefix)
        .suffix(".tmp")
        .tempfile_in(directory)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.as_file().set_permissions(permissions)?;
    #[cfg(unix)]
    copy_extended_attributes(target, temp.path());
    temp.persist(target).map_err(|error| error.error)?;

    // The rename itself is durable only once the directory entry is flushed.
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(directory) {
        let _ = dir.sync_all();
    }

    Ok(())
}

/// The start of `name`, at most `max` bytes long and cut between characters.
fn name_start(name: &str, max: usize) -> &str {
    let mut end = name.len().min(max);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

/// Finder tags, the quarantine flag and the other extended attributes belong
/// to the file the rename replaces; its successor takes them over. One the
/// system keeps to itself is left behind.
#[cfg(unix)]
fn copy_extended_attributes(from: &Path, to: &Path) {
    let Ok(names) = xattr::list(from) else {
        return;
    };
    for name in names {
        if let Ok(Some(value)) = xattr::get(from, &name) {
            let _ = xattr::set(to, &name, &value);
        }
    }
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
                encoding: Some("UTF-16LE")
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
    fn write_returns_the_version_a_read_reports() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        let lf = format(false, LineEnding::Lf);

        let written = write_document(&path, "first\n", lf, None).unwrap();

        let document = decode(fs::read(&path).unwrap()).unwrap();
        assert_eq!(document.version, written);
        assert_ne!(written, version_of(b"second\n"));
    }

    #[test]
    fn write_goes_ahead_while_the_file_holds_the_expected_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old\n").unwrap();
        let version = decode(fs::read(&path).unwrap()).unwrap().version;

        let written = write_document(
            &path,
            "new\n",
            format(false, LineEnding::Lf),
            Some(&version),
        )
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new\n");
        assert_eq!(written, version_of(b"new\n"));
    }

    #[test]
    fn write_leaves_a_file_changed_since_it_was_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old\n").unwrap();
        let version = decode(fs::read(&path).unwrap()).unwrap().version;
        fs::write(&path, b"written by another app\n").unwrap();

        let error = write_document(
            &path,
            "new\n",
            format(false, LineEnding::Lf),
            Some(&version),
        )
        .unwrap_err();

        assert!(matches!(error, DocumentError::Changed));
        assert_eq!(fs::read(&path).unwrap(), b"written by another app\n");
    }

    #[test]
    fn write_puts_back_a_file_deleted_since_it_was_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old\n").unwrap();
        let version = decode(fs::read(&path).unwrap()).unwrap().version;
        fs::remove_file(&path).unwrap();

        write_document(
            &path,
            "new\n",
            format(false, LineEnding::Lf),
            Some(&version),
        )
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new\n");
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

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_extended_attributes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old").unwrap();
        // Some file systems take no user attributes at all.
        if xattr::set(&path, "user.nyamark.test", b"red").is_err() {
            return;
        }

        write_atomically(&path, b"new").unwrap();

        assert_eq!(
            xattr::get(&path, "user.nyamark.test").unwrap().as_deref(),
            Some(&b"red"[..])
        );
    }

    #[test]
    fn atomic_write_saves_under_the_longest_name_a_file_can_have() {
        let dir = tempfile::tempdir().unwrap();
        // 255 characters, the most a file name may hold on every platform.
        let path = dir.path().join(format!("{}.md", "n".repeat(252)));
        fs::write(&path, b"old").unwrap();

        write_atomically(&path, b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
    }

    /// A path one byte short of the system's limit takes the new file, and
    /// the longer temporary file beside it fails.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn atomic_write_removes_the_empty_file_a_failed_first_write_created() {
        const PATH_MAX: usize = if cfg!(target_os = "macos") {
            1024
        } else {
            4096
        };
        let dir = tempfile::tempdir().unwrap();
        // Resolved first: a link on the way (`/var` on macOS) counts towards
        // the limit as well.
        let mut deep = fs::canonicalize(dir.path()).unwrap();
        let name = "a.md";
        let wanted = PATH_MAX - 1 - name.len() - 1;
        while deep.as_os_str().len() < wanted {
            // A folder costs its name and a separator; one byte short of the
            // mark could never be made up.
            let left = wanted - deep.as_os_str().len();
            let length = match left {
                ..=201 => left - 1,
                202 => 199,
                _ => 200,
            };
            deep.push("d".repeat(length));
        }
        fs::create_dir_all(&deep).unwrap();
        let path = deep.join(name);
        assert_eq!(path.as_os_str().len(), PATH_MAX - 1);

        assert!(write_atomically(&path, b"text").is_err());
        assert!(fs::symlink_metadata(&path).is_err());
    }

    /// xorshift64*: enough to pick moves with, and no new dependency.
    struct Moves(u64);

    impl Moves {
        fn new(seed: u64) -> Self {
            Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
        }

        fn below(&mut self, n: usize) -> usize {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 33) as usize % n
        }

        fn chance(&mut self, percent: usize) -> bool {
            self.below(100) < percent
        }

        fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
            &items[self.below(items.len())]
        }
    }

    const LINES: [&str; 5] = ["# Title", "", "text", "中文", "emoji 😀"];

    /// Bytes another program might leave: any line endings, a BOM or not,
    /// and now and then something that is not UTF-8 at all.
    fn bytes_from_elsewhere(moves: &mut Moves) -> Vec<u8> {
        match moves.below(10) {
            0 => vec![0xFF, 0xFE, b'a', 0],
            1 => vec![b'a', 0x80, b'b'],
            2 => Vec::new(),
            _ => {
                let mut bytes = Vec::new();
                if moves.chance(30) {
                    bytes.extend_from_slice(&UTF8_BOM);
                }
                for _ in 0..=moves.below(4) {
                    bytes.extend_from_slice(moves.pick(&LINES).as_bytes());
                    bytes.extend_from_slice(moves.pick(&["\n", "\r\n"]).as_bytes());
                }
                bytes
            }
        }
    }

    /// Text as the editor hands it over, a stray `\r\n` included now and then.
    fn text_from_editor(moves: &mut Moves) -> String {
        let mut text = String::new();
        for _ in 0..moves.below(4) {
            let line = *moves.pick(&LINES);
            text.push_str(line);
            text.push_str(if moves.chance(10) { "\r\n" } else { "\n" });
        }
        text
    }

    /// Each version handed out must name its bytes and nothing else.
    fn remember(versions: &mut Vec<(String, Vec<u8>)>, version: &str, bytes: &[u8]) {
        for (known, known_bytes) in versions.iter() {
            assert_eq!(
                known == version,
                known_bytes == bytes,
                "{version} and {known} against the bytes they name"
            );
        }
        versions.push((version.to_owned(), bytes.to_vec()));
    }

    /// One run of random moves on a real file: another program rewriting,
    /// deleting or locking it between the reads and writes a window makes.
    /// Whether a write may go ahead is decided from the bytes a version
    /// stood for against the bytes on disk, never from the version itself.
    fn random_run(seed: u64) {
        let mut moves = Moves::new(seed);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        let linked = cfg!(unix) && moves.chance(30);
        let target = if linked {
            dir.path().join("target.md")
        } else {
            path.clone()
        };
        fs::write(&target, bytes_from_elsewhere(&mut moves)).unwrap();
        #[cfg(unix)]
        if linked {
            std::os::unix::fs::symlink(&target, &path).unwrap();
        }

        let mut versions: Vec<(String, Vec<u8>)> = Vec::new();
        let mut latest: Option<String> = None;
        for step in 0..30 {
            let context = format!("seed {seed}, step {step}");
            let on_disk = fs::read(&target).ok();
            match moves.below(6) {
                0 => fs::write(&target, bytes_from_elsewhere(&mut moves)).unwrap(),
                1 if !linked => {
                    let _ = fs::remove_file(&path);
                }
                2 => match read_limited(&path, MAX_DOCUMENT_BYTES).and_then(decode) {
                    Ok(document) => {
                        let bytes = on_disk.unwrap();
                        remember(&mut versions, &document.version, &bytes);
                        latest = Some(document.version);
                    }
                    Err(DocumentError::Missing { .. }) => assert!(on_disk.is_none(), "{context}"),
                    Err(DocumentError::NotUtf8 { .. }) => {
                        let bytes = on_disk.unwrap();
                        assert!(
                            bytes.starts_with(&[0xFF, 0xFE])
                                || std::str::from_utf8(&bytes).is_err(),
                            "{context}: {bytes:?} taken for something other than UTF-8"
                        );
                    }
                    Err(error) => panic!("{context}: read failed: {error:?}"),
                },
                3 if on_disk.is_some() => {
                    let mut permissions = fs::metadata(&target).unwrap().permissions();
                    permissions.set_readonly(true);
                    fs::set_permissions(&target, permissions.clone()).unwrap();
                    let result = write_document(&path, "new\n", DocumentFormat::default(), None);
                    assert!(matches!(result, Err(DocumentError::ReadOnly)), "{context}");
                    assert_eq!(fs::read(&target).ok(), on_disk, "{context}");
                    #[allow(clippy::permissions_set_readonly_false)]
                    permissions.set_readonly(false);
                    fs::set_permissions(&target, permissions).unwrap();
                }
                _ => {
                    let text = text_from_editor(&mut moves);
                    let format = format(
                        moves.chance(30),
                        *moves.pick(&[LineEnding::Lf, LineEnding::Crlf]),
                    );
                    let expected = match moves.below(4) {
                        0 => None,
                        1 => latest.clone(),
                        2 if !versions.is_empty() => Some(moves.pick(&versions).0.clone()),
                        _ => Some("0-0000000000000000".to_owned()),
                    };
                    let result = write_document(&path, &text, format, expected.as_deref());
                    let after = fs::read(&target).ok();
                    let goes_ahead = match (&expected, &on_disk) {
                        (None, _) | (_, None) => true,
                        (Some(version), Some(bytes)) => versions
                            .iter()
                            .any(|(known, known_bytes)| known == version && known_bytes == bytes),
                    };
                    if goes_ahead {
                        let version = result
                            .unwrap_or_else(|error| panic!("{context}: write failed: {error:?}"));
                        let after = after.unwrap();
                        let document = decode(after.clone()).unwrap();
                        assert_eq!(document.text, text.replace("\r\n", "\n"), "{context}");
                        assert_eq!(document.format.bom, format.bom, "{context}");
                        if text.contains('\n') {
                            assert_eq!(
                                document.format.line_ending, format.line_ending,
                                "{context}"
                            );
                        }
                        remember(&mut versions, &version, &after);
                        latest = Some(version);
                    } else {
                        assert!(
                            matches!(result, Err(DocumentError::Changed)),
                            "{context}: {result:?} for a file changed since"
                        );
                        assert_eq!(after, on_disk, "{context}");
                    }
                }
            }

            // Nothing left beside the document, and a link stays a link.
            let mut names: Vec<_> = fs::read_dir(dir.path())
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .collect();
            names.sort();
            let expected_names: &[&str] = match (linked, fs::symlink_metadata(&path).is_ok()) {
                (true, _) => &["note.md", "target.md"],
                (false, true) => &["note.md"],
                (false, false) => &[],
            };
            assert_eq!(names, expected_names, "{context}");
            if linked {
                assert!(
                    fs::symlink_metadata(&path)
                        .unwrap()
                        .file_type()
                        .is_symlink(),
                    "{context}"
                );
            }
        }
    }

    #[test]
    fn writes_hold_against_another_program_in_random_orders() {
        let runs = std::env::var("FUZZ_RUNS")
            .ok()
            .and_then(|runs| runs.parse().ok())
            .unwrap_or(60);
        for seed in 1..=runs {
            random_run(seed);
        }
    }
}
