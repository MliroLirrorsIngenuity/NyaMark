// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if nyamark_lib::updater::is_updater_mode() {
        nyamark_lib::updater::run_updater();
    } else {
        nyamark_lib::run()
    }
}
