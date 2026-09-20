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
            commands::scan::analyze_directory,
            commands::scan::expand_directory,
            commands::scan::cancel_scan,
            commands::disks::open_in_explorer,
            commands::disks::get_all_disk_stats,
            commands::disks::get_physical_disks,
            commands::disks::get_disk_stats,
            commands::duplicates::find_duplicates,
            commands::large::get_large_items_report,
            commands::ai::get_ai_insights,
            commands::ai::preview_ai_prompt,
            commands::ai::cancel_ai_scan,
            commands::search::search_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
