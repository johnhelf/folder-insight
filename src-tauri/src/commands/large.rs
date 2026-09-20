//! 大文件/大目录报告生成命令。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::{Emitter, State};
use walkdir::WalkDir;

use crate::models::LargeFileInfo;
use crate::state::AppState;
use crate::utils::{format_size, is_ignored_path, normalize_path_string};

#[tauri::command]
pub async fn get_large_items_report(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    root_paths: Vec<String>,
    min_size: u64,
) -> Result<Vec<LargeFileInfo>, String> {
    let cancel_token = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut token_guard = state.ai_scan_cancel_token.lock().unwrap();
        *token_guard = Some(Arc::clone(&cancel_token));
    }

    // 同步全量 WalkDir 遍历移入 spawn_blocking，避免阻塞异步运行时线程
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut large_items = Vec::new();
        let mut dir_sizes: HashMap<String, u64> = HashMap::new();
        let mut dir_children: HashMap<String, Vec<String>> = HashMap::new();
        let mut scanned_count = 0;

        for root_path in root_paths {
            if cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                return Err::<Vec<LargeFileInfo>, String>("Scan cancelled".to_string());
            }

        let root_path_buf = PathBuf::from(&root_path);
        // We do a more comprehensive walk but still limit depth for AI context
        let walker = WalkDir::new(&root_path_buf)
            .into_iter();

        for entry in walker.filter_entry(|e| !is_ignored_path(e.path(), &root_path_buf)).filter_map(|e| e.ok()) {
            if scanned_count % 1000 == 0 {
                if cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Scan cancelled".to_string());
                }
                let _ = app.emit("ai-scan-progress", serde_json::json!({
                    "scanned": scanned_count,
                    "currentPath": entry.path().to_string_lossy().to_string()
                }));
            }
            scanned_count += 1;

            let path = entry.path();
            let path_str = normalize_path_string(&path.to_string_lossy());

            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let size = meta.len();

                    // Add to parent directory sizes
                    let mut current = path.parent();
                    while let Some(p) = current {
                        if !p.starts_with(&root_path_buf) && p != root_path_buf { break; }
                        let p_str = normalize_path_string(&p.to_string_lossy());
                        *dir_sizes.entry(p_str.clone()).or_insert(0) += size;

                        // Keep track of some children for summary
                        if p == path.parent().unwrap_or(Path::new("")) {
                            let children = dir_children.entry(p_str).or_default();
                            if children.len() < 8 {
                                children.push(format!("File: {} ({})",
                                    path.file_name().unwrap_or_default().to_string_lossy(),
                                    format_size(size)));
                            }
                        }
                        current = p.parent();
                    }

                    if size >= min_size {
                        let extension = path.extension().unwrap_or_default().to_string_lossy().to_string();
                        let last_accessed = meta.accessed().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                        let last_modified = meta.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);

                        large_items.push(LargeFileInfo {
                            path: path_str,
                            size,
                            is_dir: false,
                            extension,
                            last_accessed,
                            last_modified,
                            children_summary: None,
                        });
                    }
                } else if meta.is_dir() {
                    // For directories, we just record them as potential children of their parent
                    let current = path.parent();
                    if let Some(p) = current {
                        if p.starts_with(&root_path_buf) || p == root_path_buf {
                            let p_str = normalize_path_string(&p.to_string_lossy());
                            let children = dir_children.entry(p_str).or_default();
                            if children.len() < 8 {
                                children.push(format!("Folder: {}",
                                    path.file_name().unwrap_or_default().to_string_lossy()));
                            }
                        }
                    }
                }
            }
        }
    }

    // Now add large directories
    for (path, size) in dir_sizes {
        if size >= min_size {
            large_items.push(LargeFileInfo {
                path: path.clone(),
                size,
                is_dir: true,
                extension: "folder".to_string(),
                last_accessed: 0,
                last_modified: 0,
                children_summary: dir_children.get(&path).cloned(),
            });
        }
    }

    // Sort by size descending
    large_items.sort_by(|a, b| b.size.cmp(&a.size));
    large_items.truncate(50);

        Ok::<Vec<LargeFileInfo>, String>(large_items)
    })
    .await
    .map_err(|e| format!("Large items scan task failed: {}", e))?;

    result
}