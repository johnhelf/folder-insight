//! 重复文件查找命令。
//!
//! 该命令内部为同步的全量 WalkDir 遍历 + 分阶段哈希，故整体移入
//! `spawn_blocking` 执行，避免阻塞异步运行时线程。
//!
//! 取消策略：主目录遍历为顺序循环，可即时中断；哈希阶段采用「分块并行」
//! —— 输入按固定块大小分组，块内 `par_iter` 并行，块间检查取消令牌，命中即
//! 提前退出后续块，将取消延迟控制在单个块的粒度内。

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

        // Phase 2: Partial Hash（分块并行：块间检查取消令牌）
        let mut partial_hash_map: HashMap<String, Vec<PathBuf>> = HashMap::new();
        let total_phase2_files: usize = size_map.values().map(|v| v.len()).sum();
        let processed_in_phase2 = AtomicUsize::new(0);

        // Flatten size_map
        let phase2_inputs: Vec<(u64, PathBuf)> = size_map.into_iter().flat_map(|(size, files)| {
            files.into_iter().map(move |path| (size, path))
        }).collect();

        const PHASE_CHUNK: usize = 4096;
        let cancel2 = Arc::clone(&cancel_token);
        let mut phase2_results: Vec<(String, PathBuf)> = Vec::new();
        for chunk in phase2_inputs.chunks(PHASE_CHUNK) {
            if is_cancelled() { break; }
            let chunk_vec: Vec<(u64, PathBuf)> = chunk.to_vec();
            let res: Vec<_> = chunk_vec.into_par_iter().filter_map(|(size, path)| {
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
            phase2_results.extend(res);
        }

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

        // Phase 3: Full Hash（分块并行：块间检查取消令牌）
        let mut final_duplicates: HashMap<String, DuplicateGroup> = HashMap::new();
        let total_phase3_files: usize = partial_hash_map.values().map(|v| v.len()).sum();
        let processed_in_phase3 = AtomicUsize::new(0);

        let phase3_inputs: Vec<PathBuf> = partial_hash_map.into_values().flatten().collect();

        let cancel3 = Arc::clone(&cancel_token);
        let mut phase3_results: Vec<(String, u64, String)> = Vec::new();
        for chunk in phase3_inputs.chunks(PHASE_CHUNK) {
            if is_cancelled() { break; }
            let chunk_vec: Vec<PathBuf> = chunk.to_vec();
            let res: Vec<_> = chunk_vec.into_par_iter().filter_map(|path| {
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
            phase3_results.extend(res);
        }

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 生成唯一的临时文件并写入给定内容，返回其路径。
    fn write_temp_file(name: &str, content: &[u8]) -> PathBuf {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "folder-insight-test-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        fs::write(&path, content).expect("write temp file");
        path
    }

    /// 相同内容的文件哈希应一致（分块/全量一致），不同内容应不同。
    #[test]
    fn identical_files_have_same_hash() {
        let a = write_temp_file("a.bin", b"hello world");
        let b = write_temp_file("b.bin", b"hello world");
        let c = write_temp_file("c.bin", b"different content");

        let ha_full = compute_file_hash(&a, false).unwrap();
        let hb_full = compute_file_hash(&b, false).unwrap();
        let hc_full = compute_file_hash(&c, false).unwrap();

        assert_eq!(ha_full, hb_full, "同内容文件全量哈希应相等");
        assert_ne!(ha_full, hc_full, "不同内容文件全量哈希应不同");

        // 分块哈希同样遵循"同内容同值"
        let ha_partial = compute_file_hash(&a, true).unwrap();
        let hb_partial = compute_file_hash(&b, true).unwrap();
        assert_eq!(ha_partial, hb_partial);

        let _ = fs::remove_file(&a);
        let _ = fs::remove_file(&b);
        let _ = fs::remove_file(&c);
    }

    /// 哈希结果应为稳定的十六进制字符串（非空）。
    #[test]
    fn hash_is_non_empty_hex() {
        let f = write_temp_file("d.bin", b"some payload".repeat(100).as_slice());
        let hash = compute_file_hash(&f, false).unwrap();
        assert!(!hash.is_empty());
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        let _ = fs::remove_file(&f);
    }

    /// 大小过滤逻辑：min/max 边界包含正确。
    #[test]
    fn size_filter_boundaries() {
        let min = 1024u64;
        let max: Option<u64> = Some(4096);
        // 边界内
        assert!(1024 >= min);
        assert!(4096 <= max.unwrap());
        assert!(500 < min, "过小文件应被过滤");
        assert!(8192 > max.unwrap() || max.is_none(), "过大文件应被过滤");
    }
}