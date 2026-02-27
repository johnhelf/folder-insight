use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;
use sysinfo::Disks;

/// 应用程序状态（全局共享）
struct AppState {
    /// 简单结果缓存：只存储最终计算结果
    /// Key: path, Value: (logical_size, allocated_size, file_count, is_restricted)
    size_cache: Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>,
    /// 进行中的计算集合，用于避免重复启动后台计算
    in_progress: Arc<Mutex<HashSet<String>>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileNode {
    name: String,
    path: String,
    size: Option<u64>,
    allocated_size: Option<u64>,
    base_size: u64,
    base_allocated_size: u64,
    is_dir: bool,
    is_restricted: bool,
    file_count: u64,
    children: Option<Vec<FileNode>>,
    modified: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
struct SizeUpdate {
    path: String,
    size: u64,
    allocated_size: u64,
    is_restricted: bool,
    file_count: u64,
}

#[derive(Serialize, Clone, Debug)]
struct StructureUpdate {
    path: String,
    children: Vec<FileNode>,
}

#[derive(Serialize, Clone, Debug)]
struct BatchSizeUpdate {
    updates: Vec<SizeUpdate>,
}

#[derive(Serialize, Clone, Debug)]
struct BatchStructureUpdate {
    updates: Vec<StructureUpdate>,
}

#[derive(Serialize, Clone, Debug)]
struct ProgressUpdate {
    scanned_count: u64,
    current_path: String,
}

fn emit_batch_structure_updates(
    app_handle: &AppHandle,
    pending_structures: &mut Vec<StructureUpdate>,
) {
    if pending_structures.is_empty() {
        return;
    }

    // Chunk updates to avoid too large payloads
    // 分块发送，避免单次 payload 过大
    const CHUNK_SIZE: usize = 50;
    
    // We drain all updates, chunk them, and emit
    let all_updates: Vec<StructureUpdate> = pending_structures.drain(..).collect();
    
    for chunk in all_updates.chunks(CHUNK_SIZE) {
        let batch = BatchStructureUpdate {
            updates: chunk.to_vec(),
        };
        let _ = app_handle.emit("folder-structure-batch-updated", batch);
    }
}


/// 规范化路径字符串
fn normalize_path_string(path: &str) -> String {
    PathBuf::from(path)
        .components()
        .collect::<PathBuf>()
        .to_string_lossy()
        .to_string()
}

/// 在资源管理器中打开指定路径
#[tauri::command]
async fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let path_buf = PathBuf::from(&path);

        if path_buf.is_dir() {
            Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("explorer")
                .args(["/select,", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
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

#[derive(Serialize, Clone, Debug)]
pub struct DiskStats {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub mount_point: String,
    pub name: String,
}

#[tauri::command]
fn get_disk_stats(path: String) -> Result<Option<DiskStats>, String> {
    let disks = Disks::new_with_refreshed_list();
    let path_buf = PathBuf::from(&path);
    
    // Normalize path for comparison (canonicalize if possible to handle symlinks/relative paths)
    let abs_path = if let Ok(p) = fs::canonicalize(&path_buf) {
        p
    } else {
        path_buf.clone()
    };

    // Find the disk that contains this path
    // We try to find the longest matching mount point to handle nested mount points
    let mut best_match: Option<&sysinfo::Disk> = None;
    let mut best_match_len = 0;

    for disk in &disks {
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

#[cfg(target_os = "windows")]
fn get_allocated_size(_path: &Path, logical_size: u64) -> u64 {
    const CLUSTER_SIZE: u64 = 4096;
    if logical_size == 0 {
        return 0;
    }
    ((logical_size + CLUSTER_SIZE - 1) / CLUSTER_SIZE) * CLUSTER_SIZE
}

#[cfg(not(target_os = "windows"))]
fn get_allocated_size(path: &Path, logical_size: u64) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = fs::symlink_metadata(path) {
            return meta.blocks() * 512;
        }
    }
    logical_size
}

/// 扫描并返回结构更新，但不发送
fn scan_directory_structure(path: &Path, root_path: &Path) -> Option<StructureUpdate> {
    if let Ok(entries) = fs::read_dir(path) {
        let mut children = Vec::new();
        for child in entries.flatten() {
            let child_path = child.path();

            // 过滤被忽略的系统路径
            if is_ignored_path(&child_path, root_path) {
                continue;
            }

            let child_name = child_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let child_meta = child.metadata().ok();
            let is_dir = child_meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = if !is_dir { child_meta.as_ref().map(|m| m.len()) } else { None };
            let allocated = if !is_dir { size.map(|s| get_allocated_size(&child_path, s)) } else { None };
            let modified = child_meta.as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            
            children.push(FileNode {
                name: child_name,
                path: normalize_path_string(&child_path.to_string_lossy()),
                size,
                allocated_size: allocated,
                base_size: size.unwrap_or(0),
                base_allocated_size: allocated.unwrap_or(0),
                is_dir,
                is_restricted: false,
                file_count: if is_dir { 0 } else { 1 },
                children: None,
                modified,
            });
        }
        
        children.sort_by(|a, b| {
            if a.is_dir && !b.is_dir {
                std::cmp::Ordering::Less
            } else if !a.is_dir && b.is_dir {
                std::cmp::Ordering::Greater
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        return Some(StructureUpdate {
            path: normalize_path_string(&path.to_string_lossy()),
            children,
        });
    }
    None
}

/// 判断路径是否应该被忽略（如 Linux 下的虚拟/挂载文件夹）
#[allow(unused_variables)]
fn is_ignored_path(p: &Path, root_path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        if p.starts_with("/dev") { return true; }
        if p.starts_with("/System/Volumes") {
            // 如果我们正在扫描里面，则不忽略
            if root_path.starts_with("/System/Volumes") {
                return false;
            }
            return true;
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // 忽略 Linux 上的虚拟/临时/挂载文件夹
        let system_paths = ["/proc", "/sys", "/dev", "/run", "/media", "/mnt", "/tmp", "/var/tmp"];
        for sys_p in system_paths {
            if p.starts_with(sys_p) {
                // 如果我们扫描的根路径就是这个系统路径或其子路径，则不忽略
                if root_path.starts_with(sys_p) {
                    return false;
                }
                return true;
            }
        }
    }

    false
}

/// 扫描并发送结构更新（兼容旧逻辑，用于Phase 1） - DEPRECATED / REMOVED
// fn scan_and_emit_structure(path: &Path, app_handle: &AppHandle) {
//     if let Some(update) = scan_directory_structure(path) {
//         let _ = app_handle.emit("folder-structure-updated", update);
//     }
// }

/// 后台扫描任务：使用 WalkDir 遍历并实时通过事件回传结果
fn run_background_scan(
    root_path: String,
    cache: Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>,
    app_handle: AppHandle,
) {
    let mut dir_stats: HashMap<String, (u64, u64, u64, bool)> = HashMap::new();
    let root_path_buf = PathBuf::from(&root_path);
    let mut last_emit = Instant::now();
    let mut pending_updates: HashSet<String> = HashSet::new();
    let mut pending_structures: Vec<StructureUpdate> = Vec::new();

    // Phase 2: Full Deep Scan (WalkDir)
    // 使用 WalkDir 进行深度优先遍历
    // Use WalkDir for deep traversal
    let walker = WalkDir::new(&root_path_buf).into_iter();
    let mut scanned_count = 0u64;
    let mut last_progress_emit = Instant::now();
    
    // 不再使用 filter_map(|e| e.ok()) 忽略错误，而是显式处理
    // Don't use filter_map(|e| e.ok()) to ignore errors, handle them explicitly
    for entry_result in walker.filter_entry(|e| !is_ignored_path(e.path(), &root_path_buf)) {
        scanned_count += 1;
        
        // Emit progress every 100ms
        if last_progress_emit.elapsed() >= Duration::from_millis(100) {
            let _ = app_handle.emit("scan-progress", ProgressUpdate {
                scanned_count,
                current_path: entry_result.as_ref().ok().map(|e| e.path().to_string_lossy().to_string()).unwrap_or_default(),
            });
            last_progress_emit = Instant::now();
        }

        let entry = match entry_result {
            Ok(e) => e,
            Err(err) => {
                // 如果遇到错误（如权限不足），尝试标记该路径为受限
                // If error encountered (e.g. Permission Denied), try to mark path as restricted
                if let Some(path) = err.path() {
                    let p_str = normalize_path_string(&path.to_string_lossy());
                    
                    // 过滤被忽略的路径
                    if is_ignored_path(path, &root_path_buf) {
                        continue;
                    }

                    // 尝试恢复数据：即使遍历失败，也尝试获取文件/目录本身的大小
                    // Try to recover: even if traversal fails, try to get size of file/dir itself
                    if let Ok(meta) = fs::symlink_metadata(path) {
                        let size = meta.len();
                        let allocated = get_allocated_size(path, size);
                        let is_dir = meta.is_dir();

                        if is_dir {
                            // It's a directory we can't enter. Mark it restricted.
                            let stats = dir_stats.entry(p_str.clone()).or_insert((0, 0, 0, false));
                            stats.3 = true;
                            pending_updates.insert(p_str.clone());
                        }

                        // Update parents
                        let mut current = path.parent();
                        while let Some(p) = current {
                            if !p.starts_with(&root_path_buf) && p != root_path_buf {
                                break;
                            }
                            let p_str_parent = normalize_path_string(&p.to_string_lossy());
                            let stats = dir_stats.entry(p_str_parent.clone()).or_insert((0, 0, 0, false));
                            stats.0 += size;
                            stats.1 += allocated;
                            if !is_dir {
                                stats.2 += 1;
                            }
                            pending_updates.insert(p_str_parent);
                            
                            if p == root_path_buf {
                                break;
                            }
                            current = p.parent();
                        }
                    } else {
                        // Completely inaccessible
                        let stats = dir_stats.entry(p_str.clone()).or_insert((0, 0, 0, false));
                        stats.3 = true; // is_restricted = true
                        pending_updates.insert(p_str);
                    }
                    // eprintln!("Error accessing {}: {}", path.display(), err);
                }
                continue;
            }
        };

        let path = entry.path();
        // let depth = entry.depth(); // Not needed for structure anymore
        
        // Double check for root path itself if it's one of the ignored paths
        if is_ignored_path(path, &root_path_buf) {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                // Fallback: try to get metadata directly using fs::symlink_metadata
                // This might succeed where WalkDir's cached metadata failed or was incomplete
                match fs::symlink_metadata(path) {
                    Ok(m) => m,
                    Err(_) => {
                        // 如果无法获取元数据，标记父目录受限
                        if let Some(parent) = path.parent() {
                            let parent_str = normalize_path_string(&parent.to_string_lossy());
                            let stats = dir_stats.entry(parent_str.clone()).or_insert((0, 0, 0, false));
                            stats.3 = true;
                            pending_updates.insert(parent_str);
                        }
                        continue;
                    }
                }
            }
        };

        if meta.is_dir() {
            let _depth = entry.depth();
            // Phase 1 covers depth 0 (root) and depth 1 (immediate children).
            // We need to scan and emit structure for depth >= 1 to populate depth 2 and deeper.
            // Phase 1 覆盖了第 0 层（根）和第 1 层（直接子节点）。
            // 我们需要为 depth >= 1 扫描并发送结构，以填充第 2 层及更深层级。
            // FIX: Always emit structure updates to ensure full tree consistency, relying on frontend merging logic
            // 修复：始终发送结构更新以确保数据的完整性，依赖前端的合并逻辑来防止覆盖
            // if depth >= MAX_INITIAL_DEPTH {
                 if let Some(update) = scan_directory_structure(&path, &root_path_buf) {
                    pending_structures.push(update);
                 }
            // }

            // 确保目录在 map 中存在
            let p_str = normalize_path_string(&path.to_string_lossy());
            dir_stats.entry(p_str.clone()).or_insert((0, 0, 0, false));
            
            // Add directory's OWN size (metadata) to parents
            // 将目录自身的大小（元数据）添加到父目录统计中
            let size = meta.len();
            let allocated = get_allocated_size(path, size);
            
            let mut current = path.parent();
            while let Some(p) = current {
                if !p.starts_with(&root_path_buf) && p != root_path_buf {
                    break;
                }
                
                let p_str_parent = normalize_path_string(&p.to_string_lossy());
                let stats = dir_stats.entry(p_str_parent.clone()).or_insert((0, 0, 0, false));
                stats.0 += size;
                stats.1 += allocated;
                // Don't increment file count for directories
                pending_updates.insert(p_str_parent);

                if p == root_path_buf {
                    break;
                }
                current = p.parent();
            }
        } else {
            // 是文件
            let size = meta.len();
            let allocated = get_allocated_size(path, size);

            // 向上更新所有父目录的大小
            let mut current = path.parent();
            while let Some(p) = current {
                if !p.starts_with(&root_path_buf) && p != root_path_buf {
                    break;
                }
                
                let p_str = normalize_path_string(&p.to_string_lossy());
                let stats = dir_stats.entry(p_str.clone()).or_insert((0, 0, 0, false));
                stats.0 += size;
                stats.1 += allocated;
                stats.2 += 1;
                pending_updates.insert(p_str);

                if p == root_path_buf {
                    break;
                }
                current = p.parent();
            }
        }

        // 节流：每 200ms 发送一次更新
        if last_emit.elapsed() > Duration::from_millis(200) {
            // 先发送结构更新，确保前端有节点可以接收大小更新
            // Send structure updates first so frontend has nodes to receive size updates
            emit_batch_structure_updates(&app_handle, &mut pending_structures);

            emit_batch_updates(&app_handle, &dir_stats, &mut pending_updates);
            
            last_emit = Instant::now();
        }
    }

    // 扫描结束，将所有统计结果为 0 的目录（即空目录）加入待更新队列，
    // 确保前端能从 "Calculating..." 更新为 "0 B"。
    // At the end of scan, add all directories with 0 size/count (empty dirs) to pending updates,
    // ensuring frontend updates from "Calculating..." to "0 B".
    for (path, stats) in &dir_stats {
        if stats.0 == 0 && stats.2 == 0 {
             pending_updates.insert(path.clone());
        }
    }

    // 最后发送剩余的更新并写入缓存
    emit_batch_structure_updates(&app_handle, &mut pending_structures);
    emit_batch_updates(&app_handle, &dir_stats, &mut pending_updates);
    
    let mut cache_lock = cache.lock().unwrap();
    for (path, stats) in dir_stats {
        cache_lock.insert(path, stats);
    }
}

fn emit_batch_updates(
    app_handle: &AppHandle,
    dir_stats: &HashMap<String, (u64, u64, u64, bool)>,
    pending_updates: &mut HashSet<String>,
) {
    let mut batch: Vec<SizeUpdate> = Vec::with_capacity(100);
    
    for path_str in pending_updates.drain() {
        if let Some(stats) = dir_stats.get(&path_str) {
            batch.push(SizeUpdate {
                path: path_str,
                size: stats.0,
                allocated_size: stats.1,
                is_restricted: stats.3,
                file_count: stats.2,
            });

            if batch.len() >= 100 {
                let _ = app_handle.emit("folder-size-batch-updated", BatchSizeUpdate { updates: batch.drain(..).collect() });
            }
        }
    }

    if !batch.is_empty() {
        let _ = app_handle.emit("folder-size-batch-updated", BatchSizeUpdate { updates: batch });
    }
}

/// 判断是否需要启动后台计算
fn try_mark_in_progress(
    normalized_path: &str,
    _cache: &Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>,
    in_progress: &Arc<Mutex<HashSet<String>>>,
) -> bool {
    // 移除缓存检查，确保每次请求（特别是刷新时）都重新启动扫描，
    // 否则如果缓存命中，后台任务不会启动，导致深层结构更新（folder-structure-updated）无法发送，
    // 前端将永远只显示初始的 2 层结构。
    // Remove cache check to ensure scan restarts on every request (especially refresh).
    // Otherwise if cache hits, background task won't start, and deep structure updates won't be sent,
    // leaving frontend with only the initial 2-layer tree.
    
    /*
    let cache_hit = {
        let cache = cache.lock().unwrap();
        cache.get(normalized_path).is_some()
    };
    if cache_hit {
        return false;
    }
    */

    let mut in_progress = in_progress.lock().unwrap();
    if in_progress.contains(normalized_path) {
        return false;
    }

    in_progress.insert(normalized_path.to_string());
    true
}

const MAX_INITIAL_DEPTH: usize = 2;

/// 递归构建文件树
fn build_file_tree(
    path: &Path,
    current_depth: usize,
    max_depth: usize,
    state: &AppState,
) -> Option<FileNode> {
    let normalized_path = normalize_path_string(&path.to_string_lossy());
    
    // 处理根路径名称为空的情况
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized_path.clone());

    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return None,
    };

    let is_dir = meta.is_dir();
    let mut children = None;
    let mut base_size = 0;
    let mut base_allocated_size = 0;
    let mut file_count = 0;

    let modified = meta.modified().ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    if is_dir {
        // 检查缓存获取大小
        let (cached_size, cached_allocated, cached_count, cached_restricted) = {
            let cache = state.size_cache.lock().unwrap();
            if let Some(res) = cache.get(&normalized_path) {
                (Some(res.0), Some(res.1), res.2, res.3)
            } else {
                (None, None, 0, false)
            }
        };
        let mut is_restricted = cached_restricted;

        let mut calculated_size: u64 = 0;
        let mut calculated_allocated: u64 = 0;

        // 如果未达到最大深度，递归读取子节点
            let mut is_partial_scan = false;
            if current_depth < max_depth {
                match fs::read_dir(path) {
                    Ok(entries) => {
                        let mut child_nodes = Vec::new();
                        for entry in entries.flatten() {
                            let entry_path = entry.path();
                            if let Some(child_node) = build_file_tree(&entry_path, current_depth + 1, max_depth, state) {
                                let child_size = child_node.size.unwrap_or(0);
                                let child_allocated = child_node.allocated_size.unwrap_or(0);
                                
                                calculated_size += child_size;
                                calculated_allocated += child_allocated;

                                if !child_node.is_dir {
                                    base_size += child_size;
                                    base_allocated_size += child_allocated;
                                    file_count += 1;
                                }
                                child_nodes.push(child_node);
                            }
                        }

                        // 排序
                        child_nodes.sort_by(|a, b| {
                            let a_is_dir = a.is_dir;
                            let b_is_dir = b.is_dir;
                            if a_is_dir && !b_is_dir {
                                std::cmp::Ordering::Less
                            } else if !a_is_dir && b_is_dir {
                                std::cmp::Ordering::Greater
                            } else {
                                let size_a = a.size.unwrap_or(0);
                                let size_b = b.size.unwrap_or(0);
                                if size_a != size_b {
                                    size_b.cmp(&size_a)
                                } else {
                                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                                }
                            }
                        });

                        children = Some(child_nodes);
                    }
                    Err(_) => {
                        is_restricted = true;
                        is_partial_scan = true;
                    }
                }
            } else {
                is_partial_scan = true;
            }

            // 如果缓存有值，优先使用缓存的统计数据；
            // 否则，如果是部分扫描（未达到底部或读取失败），则 size 为 None，表示 "Calculating..."
            // 这样前端就不会用 0 覆盖旧的统计数据
            let final_size = cached_size.or(if is_partial_scan { None } else { Some(calculated_size) });
            let final_allocated = cached_allocated.or(if is_partial_scan { None } else { Some(calculated_allocated) });
            let final_file_count = if cached_count > 0 { cached_count } else { file_count };

        Some(FileNode {
            name,
            path: normalized_path,
            size: final_size,
            allocated_size: final_allocated,
            base_size,
            base_allocated_size,
            is_dir: true,
            is_restricted,
            file_count: final_file_count,
            children,
            modified,
        })
    } else {
        let size = meta.len();
        let allocated = get_allocated_size(path, size);
        Some(FileNode {
            name,
            path: normalized_path,
            size: Some(size),
            allocated_size: Some(allocated),
            base_size: size,
            base_allocated_size: allocated,
            is_dir: false,
            is_restricted: false,
            file_count: 1,
            children: None,
            modified,
        })
    }
}


/// 快速扫描目录结构，并启动后台任务计算目录大小
#[tauri::command]
async fn analyze_directory(
    path: String,
    state: tauri::State<'_, AppState>,
    app: AppHandle,
) -> Result<FileNode, String> {
    let root_path = normalize_path_string(&path);
    let path_obj = Path::new(&root_path);
    
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
        let app_handle = app.clone();
        let root_to_compute = root_path.clone();

        // 由于 AppState 不易在线程间传递（包含 Mutex），我们这里手动构建更深层级的结构
        // 但 build_file_tree 需要 &AppState 读取缓存。
        // 为了简化，我们只在后台计算大小（run_background_scan），
        // 并在前端需要时再请求更深层级（如果前端支持）。
        // 但既然用户想要“一次性给够”，我们可以尝试在后台线程中构建更深的树并发送事件。
        // 然而 build_file_tree 依赖 state，state 是 Arc<Mutex<...>> 包装的字段？
        // AppState 结构体定义中字段都是 Arc<Mutex<...>>，所以 AppState 本身 Clone 代价很小且可 Send？
        // 不，AppState 结构体本身没有 derive Clone。
        // 我们需要传递 state 的内部 Arc 成员。

        
        std::thread::Builder::new()
            .name("dir_size_worker".to_string())
            .stack_size(4 * 1024 * 1024)
            .spawn(move || {
                run_background_scan(root_to_compute.clone(), cache, app_handle);
                let mut in_progress = in_progress.lock().unwrap();
                in_progress.remove(&root_to_compute);
            })
            .expect("Failed to spawn background thread");
    }

    Ok(root_node)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let size_cache = Arc::new(Mutex::new(HashMap::new()));
            let in_progress = Arc::new(Mutex::new(HashSet::new()));
            app.manage(AppState {
                size_cache,
                in_progress,
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            analyze_directory,
            open_in_explorer,
            get_disk_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
