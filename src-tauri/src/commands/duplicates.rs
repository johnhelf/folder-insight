//! 重复文件查找命令。
//!
//! 该命令内部为同步的全量 WalkDir 遍历 + 分阶段哈希，故整体移入
//! `spawn_blocking` 执行，避免阻塞异步运行时线程。
//!
//! 取消支持为「尽力而为」：主目录遍历为顺序循环，可即时中断；第二阶段
//! 与第三阶段的 `rayon` 并行哈希无法逐条中断，但会在开工前与阶段间
//! 检查取消令牌，命中即尽早返回空结果。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use rayon::prelude::*;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::models::{DuplicateGroup, DuplicateScanOptions, DuplicateScanProgress};
use crate::state::AppState;
use crate::utils::compute_file_hash;

#[tauri::command]
pub async fn find_duplicates(
    options: DuplicateScanOptions,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DuplicateGroup>, String> {
    // 创建本次扫描的取消令牌并覆盖旧的令牌
    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.duplicate_scan_cancel_token.lock().unwrap();
        *guard = Some(cancel_token.clone());
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        // 检查取消令牌是否已触发
        let is_cancelled = || cancel_token.load(Ordering::Relaxed);

        let mut size_map: HashMap<u64, Vec<PathBuf>> = HashMap::new();
        let mut total_scanned = 0;

        // Phase 1: Group by Size
        let _ = app.emit("duplicate-scan-progress", DuplicateScanProgress {
            phase: "scanningSizes".to_string(),
            total_files: 0,
            processed_files: 0,
            current_path: "".to_string(),
        });

        for dir in &options.target_dirs {
            for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
                if is_cancelled() {
                    return Ok::<Vec<DuplicateGroup>, String>(Vec::new());
                }

                let path = entry.path();
                if !path.is_file() { continue; }

                if let Ok(metadata) = entry.metadata() {
                    let size = metadata.len();

                    if size < options.min_size { continue; }
                    if let Some(max) = options.max_size {
                        if size > max { continue; }
                    }

                    size_map.entry(size).or_default().push(path.to_path_buf());
                    total_scanned += 1;

                    if total_scanned % 1000 == 0 {
                        let _ = app.emit("duplicate-scan-progress", DuplicateScanProgress {
                            phase: "scanningSizes".to_string(),
                            total_files: total_scanned,
                            processed_files: total_scanned,
                            current_path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
            if is_cancelled() {
                return Ok::<Vec<DuplicateGroup>, String>(Vec::new());
            }
        }

        // Filter out unique sizes
        size_map.retain(|_, files| files.len() > 1);
        if is_cancelled() {
            return Ok::<Vec<DuplicateGroup>, String>(Vec::new());
        }

        // Phase 2: Partial Hash
        let mut partial_hash_map: HashMap<String, Vec<PathBuf>> = HashMap::new();
        let total_phase2_files: usize = size_map.values().map(|v| v.len()).sum();
        let processed_in_phase2 = AtomicUsize::new(0);

        // Flatten size_map
        let phase2_inputs: Vec<(u64, PathBuf)> = size_map.into_iter().flat_map(|(size, files)| {
            files.into_iter().map(move |path| (size, path))
        }).collect();

        let cancel2 = Arc::clone(&cancel_token);
        let phase2_results: Vec<_> = phase2_inputs.into_par_iter().filter_map(|(size, path)| {
            if cancel2.load(Ordering::Relaxed) { return None; }

            let count = processed_in_phase2.fetch_add(1, Ordering::Relaxed) + 1;
            if count % 10 == 0 {
                let _ = app.emit("duplicate-scan-progress", DuplicateScanProgress {
                    phase: "partialHashing".to_string(),
                    total_files: total_phase2_files as u64,
                    processed_files: count as u64,
                    current_path: path.to_string_lossy().to_string(),
                });
            }

            if let Ok(hash) = compute_file_hash(&path, true) {
                Some((format!("{}_{}", size, hash), path))
            } else {
                None
            }
        }).collect();

        if is_cancelled() {
            return Ok::<Vec<DuplicateGroup>, String>(Vec::new());
        }

        for (key, path) in phase2_results {
            partial_hash_map.entry(key).or_default().push(path);
        }

        partial_hash_map.retain(|_, files| files.len() > 1);
        if is_cancelled() {
            return Ok::<Vec<DuplicateGroup>, String>(Vec::new());
        }

        // Phase 3: Full Hash
        let mut final_duplicates: HashMap<String, DuplicateGroup> = HashMap::new();
        let total_phase3_files: usize = partial_hash_map.values().map(|v| v.len()).sum();
        let processed_in_phase3 = AtomicUsize::new(0);

        let phase3_inputs: Vec<PathBuf> = partial_hash_map.into_values().flatten().collect();

        let cancel3 = Arc::clone(&cancel_token);
        let phase3_results: Vec<_> = phase3_inputs.into_par_iter().filter_map(|path| {
            if cancel3.load(Ordering::Relaxed) { return None; }

            let count = processed_in_phase3.fetch_add(1, Ordering::Relaxed) + 1;
            if count % 5 == 0 {
                let _ = app.emit("duplicate-scan-progress", DuplicateScanProgress {
                    phase: "fullHashing".to_string(),
                    total_files: total_phase3_files as u64,
                    processed_files: count as u64,
                    current_path: path.to_string_lossy().to_string(),
                });
            }

            if let Ok(hash) = compute_file_hash(&path, false) {
                if let Ok(metadata) = path.metadata() {
                    Some((hash, metadata.len(), path.to_string_lossy().to_string()))
                } else {
                    None
                }
            } else {
                None
            }
        }).collect();

        if is_cancelled() {
            return Ok::<Vec<DuplicateGroup>, String>(Vec::new());
        }

        for (hash, size, path_str) in phase3_results {
            let entry = final_duplicates.entry(hash.clone()).or_insert_with(|| DuplicateGroup {
                hash: hash.clone(),
                size,
                files: Vec::new(),
            });
            entry.files.push(path_str);
        }

        final_duplicates.retain(|_, group| group.files.len() > 1);

        Ok::<Vec<DuplicateGroup>, String>(final_duplicates.into_values().collect())
    })
    .await
    .map_err(|e| format!("Duplicate scan task failed: {}", e))?;

    result
}

/// 取消进行中的重复文件查找（尽力而为）。
#[tauri::command]
pub async fn cancel_find_duplicates(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.duplicate_scan_cancel_token.lock().unwrap().as_ref() {
        token.store(true, Ordering::Relaxed);
    }
    Ok(())
}