use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
pub struct StoredAttachment {
    pub markdown_path: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownReferenceOptions {
    pub prefer_relative_path: bool,
    pub ensure_dot_slash: bool,
    pub escape_path: bool,
}

pub fn read_file_content<P: AsRef<Path>>(path: P) -> Result<String> {
    fs::read_to_string(&path).with_context(|| format!("Failed to read file: {:?}", path.as_ref()))
}

pub fn save_file_content<P: AsRef<Path>>(path: P, content: &str) -> Result<()> {
    fs::write(&path, content).with_context(|| format!("Failed to write file: {:?}", path.as_ref()))
}

pub fn materialize_attachment<P: AsRef<Path>>(
    document_path: P,
    file_name: &str,
    bytes: &[u8],
) -> Result<StoredAttachment> {
    let document_path = document_path.as_ref();
    let document_dir = document_dir(document_path)?;
    let asset_dir = asset_dir_for_document(document_path);
    fs::create_dir_all(&asset_dir)
        .with_context(|| format!("Failed to create asset directory: {asset_dir:?}"))?;

    let target_path = write_attachment_file(&asset_dir, file_name, bytes)?;

    let absolute_path = fs::canonicalize(&target_path)
        .unwrap_or(target_path.clone())
        .to_string_lossy()
        .into_owned();
    let markdown_path = target_path
        .strip_prefix(document_dir)
        .unwrap_or(&target_path)
        .to_string_lossy()
        .replace('\\', "/");

    Ok(StoredAttachment {
        markdown_path,
        absolute_path,
    })
}

pub fn materialize_draft_attachment<P: AsRef<Path>>(
    draft_dir: P,
    file_name: &str,
    bytes: &[u8],
) -> Result<StoredAttachment> {
    let draft_dir = draft_dir.as_ref();
    fs::create_dir_all(draft_dir)
        .with_context(|| format!("Failed to create draft asset directory: {draft_dir:?}"))?;

    let target_path = write_attachment_file(draft_dir, file_name, bytes)?;
    let absolute_path =
        normalize_markdown_path(&fs::canonicalize(&target_path).unwrap_or(target_path));

    Ok(StoredAttachment {
        markdown_path: absolute_path.clone(),
        absolute_path,
    })
}

pub fn store_attachment_in_directory<P: AsRef<Path>>(
    document_path: P,
    target_dir: &str,
    file_name: &str,
    bytes: &[u8],
    options: &MarkdownReferenceOptions,
) -> Result<StoredAttachment> {
    let document_path = document_path.as_ref();
    let storage_dir = resolve_storage_dir(document_path, target_dir)?;
    fs::create_dir_all(&storage_dir)
        .with_context(|| format!("Failed to create target directory: {storage_dir:?}"))?;

    let target_path = write_attachment_file(&storage_dir, file_name, bytes)?;
    build_stored_attachment(document_path, &target_path, options)
}

pub fn copy_local_attachment<P: AsRef<Path>>(
    document_path: P,
    source_path: &str,
    target_dir: &str,
    options: &MarkdownReferenceOptions,
) -> Result<StoredAttachment> {
    let document_path = document_path.as_ref();
    let source_path = Path::new(source_path);
    let storage_dir = resolve_storage_dir(document_path, target_dir)?;
    fs::create_dir_all(&storage_dir)
        .with_context(|| format!("Failed to create target directory: {storage_dir:?}"))?;

    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("attachment");
    let target_path = unique_file_path(&storage_dir, &sanitize_file_name(file_name));
    fs::copy(source_path, &target_path).with_context(|| {
        format!("Failed to copy attachment from {source_path:?} to {target_path:?}")
    })?;

    build_stored_attachment(document_path, &target_path, options)
}

pub fn format_markdown_reference(
    document_path: Option<&str>,
    asset_path: &str,
    options: &MarkdownReferenceOptions,
) -> Result<String> {
    let asset_path = asset_path.trim();
    if asset_path.is_empty() || looks_like_external_resource(asset_path) {
        return Ok(asset_path.to_string());
    }

    let candidate = PathBuf::from(unescape_markdown_path(asset_path));
    let normalized = fs::canonicalize(&candidate).unwrap_or(candidate);
    let document_dir = document_path.map(Path::new).map(document_dir).transpose()?;

    Ok(markdown_reference(document_dir, &normalized, options))
}

pub fn resolve_document_asset_path(
    document_path: Option<&str>,
    asset_path: &str,
) -> Result<Option<String>> {
    let asset_path = asset_path.trim();
    if asset_path.is_empty() || looks_like_external_resource(asset_path) {
        return Ok(None);
    }

    let candidate = PathBuf::from(unescape_markdown_path(asset_path));
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        let Some(document_path) = document_path else {
            return Ok(None);
        };
        let document_dir = Path::new(document_path)
            .parent()
            .with_context(|| format!("Document path has no parent: {document_path:?}"))?;
        document_dir.join(candidate)
    };

    Ok(Some(normalize_markdown_path(
        &fs::canonicalize(&resolved).unwrap_or(resolved),
    )))
}

pub fn persist_draft_attachments<P: AsRef<Path>>(
    document_path: P,
    content: &str,
    draft_dir: &Path,
) -> Result<String> {
    if !draft_dir.exists() {
        return Ok(content.to_string());
    }

    let document_path = document_path.as_ref();
    let document_dir = document_dir(document_path)?;
    let asset_dir = asset_dir_for_document(document_path);
    fs::create_dir_all(&asset_dir)
        .with_context(|| format!("Failed to create asset directory: {asset_dir:?}"))?;

    let mut rewritten = content.to_string();

    for entry in fs::read_dir(draft_dir)
        .with_context(|| format!("Failed to read draft asset directory: {draft_dir:?}"))?
    {
        let entry = entry.with_context(|| format!("Failed to read draft entry: {draft_dir:?}"))?;
        let source_path = entry.path();
        if !source_path.is_file() {
            continue;
        }

        let old_ref = normalize_markdown_path(&source_path);
        if !rewritten.contains(&old_ref) {
            continue;
        }

        let file_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("attachment");
        let target_path = unique_file_path(&asset_dir, file_name);
        move_file(&source_path, &target_path)?;

        let relative_ref = target_path
            .strip_prefix(document_dir)
            .unwrap_or(&target_path)
            .to_string_lossy()
            .replace('\\', "/");
        rewritten = rewritten.replace(&old_ref, &relative_ref);
    }

    Ok(rewritten)
}

fn document_dir(document_path: &Path) -> Result<&Path> {
    document_path
        .parent()
        .with_context(|| format!("Document path has no parent: {document_path:?}"))
}

fn build_stored_attachment(
    document_path: &Path,
    target_path: &Path,
    options: &MarkdownReferenceOptions,
) -> Result<StoredAttachment> {
    let absolute_path = normalize_markdown_path(
        &fs::canonicalize(target_path).unwrap_or(target_path.to_path_buf()),
    );
    let markdown_path =
        markdown_reference(Some(document_dir(document_path)?), target_path, options);

    Ok(StoredAttachment {
        markdown_path,
        absolute_path,
    })
}

fn asset_dir_for_document(document_path: &Path) -> PathBuf {
    let document_dir = document_path.parent().unwrap_or_else(|| Path::new("."));
    let document_stem = document_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("untitled");
    document_dir.join(format!("{document_stem}.assets"))
}

fn resolve_storage_dir(document_path: &Path, target_dir: &str) -> Result<PathBuf> {
    let document_dir = document_dir(document_path)?;
    let target_dir = target_dir.trim();
    if target_dir.is_empty() || target_dir == "." || target_dir == "./" {
        return Ok(document_dir.to_path_buf());
    }

    let candidate = PathBuf::from(target_dir);
    if candidate.is_absolute() {
        Ok(candidate)
    } else {
        Ok(document_dir.join(candidate))
    }
}

fn write_attachment_file(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf> {
    let sanitized_name = sanitize_file_name(file_name);
    let target_path = unique_file_path(dir, &sanitized_name);

    fs::write(&target_path, bytes)
        .with_context(|| format!("Failed to write attachment: {target_path:?}"))?;

    Ok(target_path)
}

fn move_file(source: &Path, target: &Path) -> Result<()> {
    if let Err(error) = fs::rename(source, target) {
        fs::copy(source, target).with_context(|| {
            format!(
                "Failed to copy draft attachment to: {target:?}; original rename error: {error}"
            )
        })?;
        fs::remove_file(source)
            .with_context(|| format!("Failed to remove draft attachment after copy: {source:?}"))?;
    }

    Ok(())
}

fn normalize_markdown_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn markdown_reference(
    document_dir: Option<&Path>,
    target_path: &Path,
    options: &MarkdownReferenceOptions,
) -> String {
    let normalized_target = fs::canonicalize(target_path).unwrap_or(target_path.to_path_buf());

    let mut reference = normalize_markdown_path(&normalized_target);

    if options.prefer_relative_path {
        if let Some(document_dir) = document_dir {
            let normalized_dir =
                fs::canonicalize(document_dir).unwrap_or(document_dir.to_path_buf());
            if let Some(relative_path) = diff_paths(&normalized_target, &normalized_dir) {
                let normalized = normalize_markdown_path(&relative_path);
                if !normalized.is_empty() && normalized != "." {
                    reference = normalized;
                }
            }
        }
    }

    if options.ensure_dot_slash && is_plain_relative_reference(&reference) {
        reference = format!("./{reference}");
    }

    if options.escape_path {
        reference = escape_markdown_path(&reference);
    }

    reference
}

fn diff_paths(path: &Path, base: &Path) -> Option<PathBuf> {
    if path.is_absolute() != base.is_absolute() {
        return None;
    }

    let path_components: Vec<_> = path.components().collect();
    let base_components: Vec<_> = base.components().collect();
    let common_length = path_components
        .iter()
        .zip(base_components.iter())
        .take_while(|(left, right)| components_equal(left, right))
        .count();

    if common_length == 0 && path.is_absolute() {
        return None;
    }

    let mut result = PathBuf::new();
    for component in &base_components[common_length..] {
        if matches!(component, Component::Normal(_)) {
            result.push("..");
        }
    }

    for component in &path_components[common_length..] {
        result.push(component.as_os_str());
    }

    Some(result)
}

fn components_equal(left: &Component<'_>, right: &Component<'_>) -> bool {
    match (left, right) {
        (Component::Prefix(a), Component::Prefix(b)) => a.kind() == b.kind(),
        _ => left == right,
    }
}

fn is_plain_relative_reference(reference: &str) -> bool {
    !reference.is_empty()
        && !reference.starts_with("./")
        && !reference.starts_with("../")
        && !reference.starts_with('/')
        && !reference.starts_with("\\")
        && !reference.contains(':')
}

fn escape_markdown_path(path: &str) -> String {
    path.replace(' ', "\\ ")
}

fn unescape_markdown_path(path: &str) -> String {
    let mut result = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(' ') = chars.peek() {
                result.push(' ');
                chars.next();
                continue;
            }
        }
        result.push(ch);
    }

    result
}

fn sanitize_file_name(file_name: &str) -> String {
    let raw_name = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("attachment");

    let (raw_stem, raw_ext) = raw_name
        .rsplit_once('.')
        .map(|(stem, ext)| (stem, Some(ext)))
        .unwrap_or((raw_name, None));

    let sanitized_stem = raw_stem
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    let stem = if sanitized_stem.is_empty() {
        "attachment".to_string()
    } else {
        sanitized_stem
    };

    match raw_ext.filter(|ext| !ext.is_empty()) {
        Some(ext) => format!("{stem}.{ext}"),
        None => stem,
    }
}

fn unique_file_path(dir: &Path, file_name: &str) -> PathBuf {
    let initial = dir.join(file_name);
    if !initial.exists() {
        return initial;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("attachment");
    let ext = path.extension().and_then(|ext| ext.to_str());

    for index in 2.. {
        let candidate = match ext {
            Some(ext) if !ext.is_empty() => dir.join(format!("{stem}-{index}.{ext}")),
            _ => dir.join(format!("{stem}-{index}")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!()
}

fn looks_like_external_resource(value: &str) -> bool {
    value.starts_with("data:")
        || value.starts_with("blob:")
        || value.starts_with("asset:")
        || value.starts_with("http://")
        || value.starts_with("https://")
        || value.starts_with("mailto:")
        || value.starts_with("tel:")
}
