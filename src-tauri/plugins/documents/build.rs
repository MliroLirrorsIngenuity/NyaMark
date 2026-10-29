const COMMANDS: &[&str] = &[
    "locations",
    "pick_folder",
    "remove_folder",
    "list",
    "create_document",
    "rename",
    "delete",
    "pick_document",
    "recents",
    "remove_recent",
    "opened",
    "set_current",
    "current",
    "share",
    "share_pdf",
    "print",
    "drain_inbox",
    "download",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
