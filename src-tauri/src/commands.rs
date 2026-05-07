use tauri::command;
use crate::file;

#[command]
pub fn read_markdown(path: String) -> Result<String, String> {
    file::read_file_content(&path).map_err(|e| e.to_string())
}

#[command]
pub fn materialize_attachment(
    document_path: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<file::StoredAttachment, String> {
    file::materialize_attachment(&document_path, &file_name, &bytes)
        .map_err(|e| e.to_string())
}

#[command]
pub fn store_attachment_in_directory(
    document_path: String,
    target_dir: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<file::StoredAttachment, String> {
    file::store_attachment_in_directory(&document_path, &target_dir, &file_name, &bytes)
        .map_err(|e| e.to_string())
}

#[command]
pub fn copy_local_attachment(
    document_path: String,
    source_path: String,
    target_dir: String,
) -> Result<file::StoredAttachment, String> {
    file::copy_local_attachment(&document_path, &source_path, &target_dir)
        .map_err(|e| e.to_string())
}

#[command]
pub fn resolve_document_asset_path(
    document_path: Option<String>,
    asset_path: String,
) -> Result<Option<String>, String> {
    file::resolve_document_asset_path(document_path.as_deref(), &asset_path)
        .map_err(|e| e.to_string())
}

#[command]
pub fn format_markdown_reference(
    document_path: Option<String>,
    asset_path: String,
) -> Result<String, String> {
    file::format_markdown_reference(document_path.as_deref(), &asset_path)
        .map_err(|e| e.to_string())
}
