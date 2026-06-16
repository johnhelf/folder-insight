use std::path::PathBuf;
use std::process::Command;
use std::path::Path;
use std::time::SystemTime;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use sysinfo::Disks;
use std::collections::HashMap;
use walkdir::WalkDir;
use rayon::prelude::*;
use std::sync::atomic::AtomicUsize;
use regex::Regex;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::models::{
    AIReportResult, DiskStats, PhysicalDisk, DuplicateGroup, DuplicateScanOptions, DuplicateScanProgress,
    FileNode, LargeFileInfo, SearchResult,
};
use crate::state::AppState;
use crate::utils::{compute_file_hash, normalize_path_string, parse_size_str, try_mark_in_progress, format_size, is_ignored_path};
use crate::scanner::{build_file_tree, run_background_scan, MAX_INITIAL_DEPTH};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 创建一个不会显示控制台窗口的 Command（Windows 专用）
#[cfg(target_os = "windows")]
fn create_hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 在资源管理器中打开指定路径
#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let path = path.replace("/", "\\");
        let path_buf = PathBuf::from(&path);

        if path_buf.is_dir() {
            create_hidden_command("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            // Use /select,path to select the file in Explorer
            create_hidden_command("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let path_buf = PathBuf::from(&path);
        // Linux 下 xdg-open 通常不支持选中文件，所以如果是文件，我们打开其父目录
        // Linux xdg-open usually doesn't support selecting files, so if it's a file, open its parent dir
        let target_path = if path_buf.is_file() {
             path_buf.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())
        } else {
             path.clone()
        };

        Command::new("xdg-open")
            .arg(&target_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_physical_disks() -> Result<Vec<PhysicalDisk>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut disks = Vec::new();
        let script = r#"
            $disks = Get-Disk
            $result = @()
            foreach ($d in $disks) {
                $parts = @(Get-Partition -DiskNumber $d.Number | Where-Object DriveLetter | Select-Object -ExpandProperty DriveLetter)
                $result += @{
                    Number = $d.Number
                    FriendlyName = $d.FriendlyName
                    Partitions = ($parts -join ',')
                }
            }
            $result | ConvertTo-Json
        "#;
        let output = create_hidden_command("powershell")
            .args(&["-NoProfile", "-Command", script])
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let json_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    if let Some(arr) = json.as_array() {
                        for item in arr {
                            if let (Some(num), Some(name)) = (item["Number"].as_u64(), item["FriendlyName"].as_str()) {
                                let partitions = item["Partitions"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
                                disks.push(PhysicalDisk {
                                    number: num as u32,
                                    name: name.to_string(),
                                    partitions,
                                });
                            }
                        }
                    } else if let Some(obj) = json.as_object() {
                        if let (Some(num), Some(name)) = (obj["Number"].as_u64(), obj["FriendlyName"].as_str()) {
                            let partitions = obj["Partitions"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
                            disks.push(PhysicalDisk {
                                number: num as u32,
                                name: name.to_string(),
                                partitions,
                            });
                        }
                    }
                }
            }
        }
        Ok(disks)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // For non-Windows, we just fallback to returning nothing or empty
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn get_all_disk_stats() -> Result<Vec<DiskStats>, String> {
    let disks = Disks::new_with_refreshed_list();
    let mut stats = Vec::new();
    
    for disk in disks.list() {
        stats.push(DiskStats {
            total: disk.total_space(),
            used: disk.total_space() - disk.available_space(),
            available: disk.available_space(),
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            name: disk.name().to_string_lossy().to_string(),
        });
    }
    
    Ok(stats)
}

#[tauri::command]
pub fn get_disk_stats(path: String) -> Result<Option<DiskStats>, String> {
    let disks = Disks::new_with_refreshed_list();
    let path_buf = PathBuf::from(&path);
    
    // Normalize path for comparison (canonicalize if possible to handle symlinks/relative paths)
    let abs_path = if let Ok(p) = std::fs::canonicalize(&path_buf) {
        p
    } else {
        path_buf.clone()
    };

    // Find the disk that contains this path
    // We try to find the longest matching mount point to handle nested mount points
    let mut best_match: Option<&sysinfo::Disk> = None;
    let mut best_match_len = 0;

    for disk in disks.list() {
        let mount_point = disk.mount_point();
        if abs_path.starts_with(mount_point) {
            let len = mount_point.as_os_str().len();
            if len > best_match_len {
                best_match = Some(disk);
                best_match_len = len;
            }
        }
    }

    if let Some(disk) = best_match {
        return Ok(Some(DiskStats {
            total: disk.total_space(),
            used: disk.total_space() - disk.available_space(),
            available: disk.available_space(),
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            name: disk.name().to_string_lossy().to_string(),
        }));
    }
    
    Ok(None)
}

/// 快速扫描目录结构，并启动后台任务计算目录大小
#[tauri::command]
pub async fn analyze_directory(
    path: String,
    state: tauri::State<'_, AppState>,
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
pub fn cancel_scan(state: tauri::State<'_, AppState>) {
    let mut token_guard = state.current_scan_cancel_token.lock().unwrap();
    if let Some(token) = token_guard.as_ref() {
        token.store(true, Ordering::Relaxed);
    }
    // Detach the token so new scans can start with a fresh one
    *token_guard = None;
}

#[tauri::command]
pub async fn find_duplicates(
    options: DuplicateScanOptions,
    app: AppHandle,
) -> Result<Vec<DuplicateGroup>, String> {
    // We would use rayon here if we added it, but for now we'll do it synchronously or spawn a thread
    // This is a simplified version of the 3-step process
    
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
    }
    
    // Filter out unique sizes
    size_map.retain(|_, files| files.len() > 1);
    
    // Phase 2: Partial Hash
    let mut partial_hash_map: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let total_phase2_files: usize = size_map.values().map(|v| v.len()).sum();
    let processed_in_phase2 = AtomicUsize::new(0);
    
    // Flatten size_map
    let phase2_inputs: Vec<(u64, PathBuf)> = size_map.into_iter().flat_map(|(size, files)| {
        files.into_iter().map(move |path| (size, path))
    }).collect();

    let phase2_results: Vec<_> = phase2_inputs.into_par_iter().filter_map(|(size, path)| {
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

    for (key, path) in phase2_results {
        partial_hash_map.entry(key).or_default().push(path);
    }
    
    partial_hash_map.retain(|_, files| files.len() > 1);
    
    // Phase 3: Full Hash
    let mut final_duplicates: HashMap<String, DuplicateGroup> = HashMap::new();
    let total_phase3_files: usize = partial_hash_map.values().map(|v| v.len()).sum();
    let processed_in_phase3 = AtomicUsize::new(0);
    
    let phase3_inputs: Vec<PathBuf> = partial_hash_map.into_values().flatten().collect();

    let phase3_results: Vec<_> = phase3_inputs.into_par_iter().filter_map(|path| {
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

    for (hash, size, path_str) in phase3_results {
        let entry = final_duplicates.entry(hash.clone()).or_insert_with(|| DuplicateGroup {
            hash: hash.clone(),
            size,
            files: Vec::new(),
        });
        entry.files.push(path_str);
    }
    
    final_duplicates.retain(|_, group| group.files.len() > 1);
    
    Ok(final_duplicates.into_values().collect())
}

#[tauri::command]
pub async fn cancel_ai_scan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.ai_scan_cancel_token.lock().unwrap().as_ref() {
        token.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_large_items_report(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    root_paths: Vec<String>,
    min_size: u64,
) -> Result<Vec<LargeFileInfo>, String> {
    let cancel_token = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut token_guard = state.ai_scan_cancel_token.lock().unwrap();
        *token_guard = Some(Arc::clone(&cancel_token));
    }

    let mut large_items = Vec::new();
    let mut dir_sizes: HashMap<String, u64> = HashMap::new();
    let mut dir_children: HashMap<String, Vec<String>> = HashMap::new();
    let mut scanned_count = 0;
    
    for root_path in root_paths {
        if cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("Scan cancelled".to_string());
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
    
    Ok(large_items)
}

fn build_ai_prompt(files: &Vec<LargeFileInfo>, language: &str) -> String {
    let mut prompt = format!("Please analyze the following large files and provide recommendations. 
IMPORTANT REQUIREMENTS:
1. You MUST respond in this language: {}.
2. For each file, provide a 'reason' for your suggestion and an 'action' (e.g., 'Delete', 'Compress', 'Archive', 'Keep'). Keep it concise.
3. If your recommendation involves using specialized Windows tools, you MUST include a brief usage tutorial or an official documentation link in the 'reason' field. For example:
   - Component store; use DISM to clean safely (https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder)
   - Old driver packages can be removed using pnputil (https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/pnputil)
   - Orphaned installer file; verify with PatchCleaner (https://patchcleaner.codeplex.com/)

Files to analyze:\n\n", language);
    for file in files {
        let type_str = if file.is_dir { "Folder" } else { "File" };
        prompt.push_str(&format!("Type: {}, Path: {}, Size: {} bytes, Ext: {}, Last Modified: {} unix timestamp\n", 
            type_str, file.path, file.size, file.extension, file.last_modified));
    }
    
    prompt.push_str("\nRespond ONLY with a JSON array of objects, where each object has 'path', 'reason', and 'action' fields. Ensure valid JSON.");
    
    prompt
}

#[tauri::command]
pub async fn preview_ai_prompt(files: Vec<LargeFileInfo>, language: String) -> Result<String, String> {
    Ok(build_ai_prompt(&files, &language))
}

#[derive(serde::Serialize)]
pub struct AIInsightResponse {
    pub results: Vec<AIReportResult>,
    pub raw_response: String,
}

#[tauri::command]
pub async fn get_ai_insights(
    api_key: String,
    api_url: String,
    model: String,
    files: Vec<LargeFileInfo>,
    language: String,
) -> Result<AIInsightResponse, String> {
    if files.is_empty() {
        return Ok(AIInsightResponse {
            results: Vec::new(),
            raw_response: String::new(),
        });
    }

    let mut final_api_url = api_url.trim().to_string();
    if final_api_url.ends_with('/') {
        final_api_url.pop();
    }
    if !final_api_url.ends_with("/chat/completions") && !final_api_url.contains("/v1/messages") && !final_api_url.contains("/api/generate") {
        if final_api_url.ends_with("/v1") {
            final_api_url.push_str("/chat/completions");
        } else {
            final_api_url.push_str("/v1/chat/completions");
        }
    }

    let client = reqwest::Client::new();
    let prompt = build_ai_prompt(&files, &language);

    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant that analyzes large files and folders and suggests actions to free up disk space."
            },
            {
                "role": "user",
                "content": prompt
            }
        ]
    });
    
    let response = client.post(&final_api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
        
    let status = response.status();
    let response_text = response.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
    
    if !status.is_success() {
        return Err(format!("AI API returned error status {}: {}", status, response_text));
    }

    if response_text.trim().is_empty() {
        return Err("AI API returned an empty response body".to_string());
    }
    
    let response_json: serde_json::Value = serde_json::from_str(&response_text).map_err(|e| format!("Failed to parse response JSON: {}, response text: {}", e, response_text))?;
    
    let content = response_json["choices"][0]["message"]["content"].as_str().ok_or("Failed to extract content from AI response")?;
    
    let content_clean = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    
    if content_clean.is_empty() {
        return Err("AI response content is empty after cleaning".to_string());
    }

    let results: Vec<AIReportResult> = serde_json::from_str(content_clean).map_err(|e| format!("Failed to parse AI response content JSON: {}, content: {}", e, content_clean))?;
    
    Ok(AIInsightResponse {
        results,
        raw_response: response_text,
    })
}

#[tauri::command]
pub async fn search_files(
    query: String,
    root_path: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let max_results = 1000;

    let roots: Vec<PathBuf> = if let Some(p) = root_path {
        if p == "ALL_DISKS" {
            let disks = Disks::new_with_refreshed_list();
            disks.list().iter().map(|d| d.mount_point().to_path_buf()).collect()
        } else {
            vec![PathBuf::from(p)]
        }
    } else {
        let disks = Disks::new_with_refreshed_list();
        disks.list().iter().map(|d| d.mount_point().to_path_buf()).collect()
    };

    // Parse query
    let mut size_filter: Option<(char, u64)> = None; // (operator, bytes)
    let mut ext_filter: Option<String> = None;
    let mut name_regex: Option<Regex> = None;

    if query.starts_with("size:") {
        let rest = &query[5..];
        let operator = if rest.starts_with('>') { '>' } else if rest.starts_with('<') { '<' } else { '=' };
        let num_part = if operator == '=' { rest } else { &rest[1..] };
        
        if let Some(bytes) = parse_size_str(num_part) {
             size_filter = Some((operator, bytes));
        }
    } else if query.starts_with("ext:") {
        ext_filter = Some(query[4..].to_lowercase());
    } else {
        // Treat as regex, case insensitive
        match Regex::new(&format!("(?i){}", query)) {
            Ok(re) => name_regex = Some(re),
            Err(_) => return Err("Invalid regex".to_string()),
        }
    }

    for root in roots {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if results.len() >= max_results {
                break;
            }
            
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            
            let name = entry.file_name().to_string_lossy().to_string();
            let size = metadata.len();
            let is_dir = metadata.is_dir();
            
            let mut matches = true;

            if let Some((op, target_size)) = size_filter {
                matches = match op {
                    '>' => size > target_size,
                    '<' => size < target_size,
                    _ => size == target_size,
                };
            } else if let Some(ref ext) = ext_filter {
                 if let Some(e) = entry.path().extension() {
                     matches = e.to_string_lossy().to_lowercase() == *ext;
                 } else {
                     matches = false;
                 }
            } else if let Some(ref re) = name_regex {
                matches = re.is_match(&name);
            }

            if matches {
                results.push(SearchResult {
                    path: entry.path().to_string_lossy().to_string(),
                    name,
                    size,
                    is_dir,
                });
            }
        }
        if results.len() >= max_results {
            break;
        }
    }

    Ok(results)
}
