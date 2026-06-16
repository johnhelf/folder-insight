pub mod commands;
pub mod models;
pub mod scanner;
pub mod state;
pub mod utils;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let size_cache = Arc::new(Mutex::new(HashMap::new()));
            let in_progress = Arc::new(Mutex::new(HashSet::new()));
            let disk_map = Arc::new(Mutex::new(HashMap::new()));
            let disk_locks = Arc::new(Mutex::new(HashMap::new()));
            let current_scan_cancel_token = Arc::new(Mutex::new(None));
            let ai_scan_cancel_token = Arc::new(Mutex::new(None));
            
            app.manage(AppState {
                size_cache,
                in_progress,
                disk_map,
                disk_locks,
                current_scan_cancel_token,
                ai_scan_cancel_token,
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::analyze_directory,
            commands::open_in_explorer,
            commands::get_all_disk_stats,
            commands::get_physical_disks,
            commands::get_disk_stats,
            commands::find_duplicates,
            commands::get_large_items_report,
            commands::get_ai_insights,
            commands::preview_ai_prompt,
            commands::search_files,
            commands::cancel_scan,
            commands::cancel_ai_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
