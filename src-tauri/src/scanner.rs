use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use walkdir::WalkDir;

use crate::models::{FileNode, ProgressUpdate, StructureUpdate};
use crate::state::{AppState, SizeCache};
use crate::utils::{emit_batch_structure_updates, emit_batch_updates, get_allocated_size, is_ignored_path, normalize_path_string};

// MAX_INITIAL_DEPTH determines how deep the synchronous scan goes before returning to UI
// 降低初始同步扫描深度，避免前端长时间黑屏等待，改为由后台异步任务继续扫描
pub const MAX_INITIAL_DEPTH: usize = 2;

/// 扫描并返回结构更新，但不发送
pub fn scan_directory_structure(path: &Path, root_path: &Path) -> Option<StructureUpdate> {
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

/// 后台扫描任务：使用 WalkDir 遍历并实时通过事件回传结果
pub fn run_background_scan(
    root_paths: Vec<String>,
    cache: SizeCache,
    app_handle: tauri::AppHandle,
    emit_complete: bool,
    cancel_token: Arc<AtomicBool>,
    total_size_override: Option<u64>,
) {
    let mut dir_stats: HashMap<String, (u64, u64, u64, bool)> = HashMap::new();
    let mut last_emit = Instant::now();
    let mut pending_updates: HashSet<String> = HashSet::new();
    let mut pending_structures: Vec<StructureUpdate> = Vec::new();
    let mut scanned_count = 0u64;
    let mut scanned_size = 0u64;
    let mut last_progress_emit = Instant::now();

    // Try to determine total size for progress reporting
    let mut total_size = total_size_override;
    if total_size.is_none() && root_paths.len() == 1 {
        // If it's a single path and looks like a drive root, try to get its used space
        let path = Path::new(&root_paths[0]);
        if path.parent().is_none() || (cfg!(windows) && path.to_string_lossy().len() <= 3) {
            use sysinfo::Disks;
            let disks = Disks::new_with_refreshed_list();
            for disk in disks.list() {
                if path.starts_with(disk.mount_point()) {
                    total_size = Some(disk.total_space() - disk.available_space());
                    break;
                }
            }
        }
    }

    for root_path in root_paths {
        // Check cancellation at the start of each root path
        if cancel_token.load(Ordering::Relaxed) {
            break;
        }

        let root_path_buf = PathBuf::from(&root_path);
        let disk_name = Some(root_path.clone()); // Simple disk identifier
        
        // 使用 WalkDir 进行深度优先遍历
        let walker = WalkDir::new(&root_path_buf).into_iter();
        
        // 不再使用 filter_map(|e| e.ok()) 忽略错误，而是显式处理
        for entry_result in walker.filter_entry(|e| !is_ignored_path(e.path(), &root_path_buf)) {
            // Check cancellation
            if cancel_token.load(Ordering::Relaxed) {
                break;
            }

            scanned_count += 1;
            
            // Emit progress every 100ms
            if last_progress_emit.elapsed() >= Duration::from_millis(100) {
                let _ = app_handle.emit("scan-progress", ProgressUpdate {
                    scanned_count,
                    scanned_size,
                    current_path: entry_result.as_ref().ok().map(|e| e.path().to_string_lossy().to_string()).unwrap_or_default(),
                    disk_name: disk_name.clone(),
                    total_size,
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
                        scanned_size += size;
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

        scanned_size += meta.len();

        if meta.is_dir() {
            let _depth = entry.depth();
            // Phase 1 covers depth 0 (root) and depth 1 (immediate children).
            // We need to scan and emit structure for depth >= 1 to populate depth 2 and deeper.
            // 修复：限制结构更新的深度，避免发送几百万个节点导致前端卡死和 OOM
            // 仅对浅层目录发送结构更新，深层目录在用户手动展开时由前端请求
            if entry.depth() <= MAX_INITIAL_DEPTH {
                 if let Some(update) = scan_directory_structure(path, &root_path_buf) {
                    pending_structures.push(update);
                 }
            }

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

    } // end of for root_path in root_paths

    // 扫描结束，将所有目录加入待更新队列，确保最终一致性
    // At the end of scan, add ALL directories to pending updates to ensure final consistency
    for (path, _stats) in &dir_stats {
        pending_updates.insert(path.clone());
    }

    // 最后发送剩余的更新并写入缓存
    emit_batch_structure_updates(&app_handle, &mut pending_structures);
    emit_batch_updates(&app_handle, &dir_stats, &mut pending_updates);
    
    let mut cache_lock = cache.lock().unwrap();
    for (path, stats) in dir_stats {
        cache_lock.insert(path, stats);
    }

    if emit_complete {
        if cancel_token.load(Ordering::Relaxed) {
             let _ = app_handle.emit("scan-cancelled", ());
        } else {
             let _ = app_handle.emit("scan-complete", ());
        }
    }
}

/// 递归构建文件树
pub fn build_file_tree(
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
