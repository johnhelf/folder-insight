//! 目录扫描相关命令：分析目录、展开目录、取消扫描。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::Disks;
use tauri::{AppHandle, Emitter, State};

use crate::models::FileNode;
use crate::scanner::{MAX_INITIAL_DEPTH, build_file_tree, run_background_scan};
use crate::state::AppState;
use crate::utils::{normalize_path_string, try_mark_in_progress};

/// 快速扫描目录结构，并启动后台任务计算目录大小
#[tauri::command]
pub async fn analyze_directory(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<FileNode, String> {
    // Create a new cancellation token for this scan
    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let mut token_guard = state.current_scan_cancel_token.lock().unwrap();
        // If there was an existing scan, cancel it
        if let Some(existing) = token_guard.as_ref() {
            existing.store(true, Ordering::Relaxed);
        }
        *token_guard = Some(cancel_token.clone());
    }

    // Handle "My Computer" / All Disks case
    if path == "ALL_DISKS" || path.starts_with("PHYSICAL_DISK:") {
        let is_all_disks = path == "ALL_DISKS";
        let target_disk_num = if is_all_disks {
            None
        } else {
            path.split(':').nth(1).and_then(|s| s.parse::<u32>().ok())
        };

        let disks = Disks::new_with_refreshed_list();
        let mut children = Vec::new();
        let mut root_paths = Vec::new();

        let mut total_used = 0;
        let mut total_allocated = 0;

        // Ensure partition map is populated before filtering
        if !is_all_disks {
            let mut map = state.disk_map.lock().unwrap();
            if map.is_empty() {
                #[cfg(target_os = "windows")]
                {
                    *map = crate::utils::get_disk_partition_map();
                }
            }
        }

        for disk in disks.list() {
            let mount_point = disk.mount_point().to_string_lossy().to_string();
            let normalized_mount = normalize_path_string(&mount_point);

            // Check if this mount point belongs to the target physical disk
            if !is_all_disks {
                #[cfg(target_os = "windows")]
                {
                    let drive = normalized_mount.chars().take(2).collect::<String>();
                    let map = state.disk_map.lock().unwrap();
                    if let Some(&num) = map.get(&drive) {
                        if Some(num) != target_disk_num {
                            continue;
                        }
                    } else {
                        // If we can't map it, skip it when scanning specific physical disk
                        continue;
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    // Fallback for non-windows if physical disk scan is requested
                    continue;
                }
            }

            let name = disk.name().to_string_lossy().to_string();
            let display_name = if name.is_empty() { mount_point.clone() } else { format!("{} ({})", name, mount_point) };

            let total = disk.total_space();
            let available = disk.available_space();
            let used = total - available;

            total_used += used;
            total_allocated += used; // Approx

            children.push(FileNode {
                name: display_name,
                path: normalized_mount.clone(),
                size: Some(used),
                allocated_size: Some(used),
                base_size: used,
                base_allocated_size: used,
                is_dir: true,
                is_restricted: false,
                file_count: 0,
                children: None, // Will be filled by background scan updates
                modified: None,
            });
            root_paths.push(normalized_mount);
        }

        if root_paths.is_empty() {
            return Err("No drives found for the specified target".to_string());
        }

        // Sort children by name
        children.sort_by(|a, b| a.name.cmp(&b.name));

        // Start background scan for ALL disks
        let cache = state.size_cache.clone();
        let in_progress = state.in_progress.clone();
        let app_handle = app.clone();
        let disk_map = state.disk_map.clone();
        let disk_locks = state.disk_locks.clone();
        let cancel_token = cancel_token.clone();

        // Mark all roots as in progress
        {
            let mut in_progress_lock = in_progress.lock().unwrap();
            for path in &root_paths {
                in_progress_lock.insert(path.clone());
            }
        }

        std::thread::Builder::new()
            .name("all_disks_coordinator".to_string())
            .stack_size(4 * 1024 * 1024)
            .spawn(move || {
                // 1. Get partition mapping if empty
                {
                    let mut map = disk_map.lock().unwrap();
                    if map.is_empty() {
                        #[cfg(target_os = "windows")]
                        {
                            *map = crate::utils::get_disk_partition_map();
                        }
                    }
                }

                // 2. Group roots by physical disk
                let mut physical_disk_groups: HashMap<u32, Vec<String>> = HashMap::new();
                let mut unknown_disk_roots: Vec<String> = Vec::new();

                {
                    let map = disk_map.lock().unwrap();
                    for root in &root_paths {
                        // Extract drive letter (e.g. "C:")
                        // Windows specific logic for mapping
                        #[cfg(target_os = "windows")]
                        {
                            let drive = root.chars().take(2).collect::<String>();
                            if let Some(&disk_num) = map.get(&drive) {
                                physical_disk_groups.entry(disk_num).or_default().push(root.clone());
                            } else {
                                unknown_disk_roots.push(root.clone());
                            }
                        }
                        #[cfg(not(target_os = "windows"))]
                        {
                            unknown_disk_roots.push(root.clone());
                        }
                    }
                }

                let mut handles = vec![];

                // 3. Spawn threads for physical disks
                for (disk_num, roots) in physical_disk_groups {
                    let cache = cache.clone();
                    let app = app_handle.clone();
                    let disk_locks = disk_locks.clone();
                    let cancel_token = cancel_token.clone();

                    let handle = std::thread::spawn(move || {
                        // Acquire lock for this physical disk to prevent thrashing
                        // 获取物理磁盘锁以防止磁头争抢
                        let disk_lock_arc = {
                            let mut locks = disk_locks.lock().unwrap();
                            locks.entry(disk_num).or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(()))).clone()
                        };
                        let _guard = disk_lock_arc.lock().unwrap();

                        // Run sequentially for this physical disk
                        // run_background_scan iterates over roots sequentially
                        run_background_scan(roots, cache, app, false, cancel_token, None);
                    });
                    handles.push(handle);
                }

                // 4. Spawn thread for unknown disks (parallel to others, sequential within itself)
                if !unknown_disk_roots.is_empty() {
                    let cache = cache.clone();
                    let app = app_handle.clone();
                    let cancel_token = cancel_token.clone();
                    let handle = std::thread::spawn(move || {
                        run_background_scan(unknown_disk_roots, cache, app, false, cancel_token, None);
                    });
                    handles.push(handle);
                }

                // 5. Wait for all
                for h in handles {
                    let _ = h.join();
                }

                let mut in_progress_lock = in_progress.lock().unwrap();
                for path in root_paths {
                    in_progress_lock.remove(&path);
                }

                if cancel_token.load(Ordering::Relaxed) {
                    let _ = app_handle.emit("scan-cancelled", ());
                } else {
                    let _ = app_handle.emit("scan-complete", ());
                }
            })
            .expect("Failed to spawn background thread");

        let return_name = if is_all_disks {
            "ALL_DISKS".to_string()
        } else {
            format!("PHYSICAL_DISK_{}", target_disk_num.unwrap_or(0))
        };

        return Ok(FileNode {
            name: return_name,
            path: path.clone(),
            size: Some(total_used),
            allocated_size: Some(total_allocated),
            base_size: total_used,
            base_allocated_size: total_allocated,
            is_dir: true,
            is_restricted: false,
            file_count: 0,
            children: Some(children),
            modified: None,
        });
    }

    let root_path = normalize_path_string(&path);
    let path_obj = Path::new(&root_path);

    // Determine total size for folder/drive scan
    let mut total_size_for_eta = None;
    if path_obj.parent().is_none() || (cfg!(windows) && root_path.len() <= 3) {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        for disk in disks.list() {
            if path_obj.starts_with(disk.mount_point()) {
                total_size_for_eta = Some(disk.total_space() - disk.available_space());
                break;
            }
        }
    } else {
        // Try to get from cache if it's a folder
        let cache = state.size_cache.lock().unwrap();
        if let Some(stats) = cache.get(&root_path) {
            if stats.0 > 0 {
                total_size_for_eta = Some(stats.0);
            }
        }
    }

    // 递归构建初始树（默认深度 1，快速返回）
    // Recursively build initial tree (depth 1, fast return)
    let root_node = build_file_tree(path_obj, 0, MAX_INITIAL_DEPTH, &state)
        .ok_or_else(|| "Failed to access directory".to_string())?;

    // 启动后台扫描任务
    let should_compute_root =
        try_mark_in_progress(&root_path, &state.size_cache, &state.in_progress);

    if should_compute_root {
        let cache = state.size_cache.clone();
        let in_progress = state.in_progress.clone();
        let disk_locks = state.disk_locks.clone(); // Pass locks to thread
        let app_handle = app.clone();
        let root_to_compute = root_path.clone();

        std::thread::Builder::new()
            .name("dir_size_worker".to_string())
            .stack_size(4 * 1024 * 1024)
            .spawn(move || {
                // Try to identify physical disk and acquire lock to prevent thrashing
                let disk_num = crate::utils::get_disk_number(Path::new(&root_to_compute));

                let disk_lock_arc = if let Some(n) = disk_num {
                    let mut locks = disk_locks.lock().unwrap();
                    Some(locks.entry(n).or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(()))).clone())
                } else {
                    None
                };

                let _guard = if let Some(lock) = &disk_lock_arc {
                    Some(lock.lock().unwrap())
                } else {
                    None
                };

                run_background_scan(vec![root_to_compute.clone()], cache, app_handle, true, cancel_token, total_size_for_eta);
                let mut in_progress = in_progress.lock().unwrap();
                in_progress.remove(&root_to_compute);
            })
            .expect("Failed to spawn background thread");
    }

    Ok(root_node)
}

#[tauri::command]
pub async fn expand_directory(
    path: String,
    state: State<'_, AppState>,
) -> Result<FileNode, String> {
    let root_path = normalize_path_string(&path);
    let path_obj = Path::new(&root_path);

    // 仅读取一层子目录，不启动后台扫描
    let root_node = build_file_tree(path_obj, 0, 1, &state)
        .ok_or_else(|| "Failed to access directory".to_string())?;

    Ok(root_node)
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) {
    let mut token_guard = state.current_scan_cancel_token.lock().unwrap();
    if let Some(token) = token_guard.as_ref() {
        token.store(true, Ordering::Relaxed);
    }
    // Detach the token so new scans can start with a fresh one
    *token_guard = None;
}