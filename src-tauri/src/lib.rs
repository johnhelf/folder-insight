use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

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

/// 扫描并发送结构更新
fn scan_and_emit_structure(path: &Path, app_handle: &AppHandle) {
    if let Ok(entries) = fs::read_dir(path) {
        let mut children = Vec::new();
        for child in entries.flatten() {
            let child_path = child.path();
            let child_name = child_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let child_meta = child.metadata().ok();
            let is_dir = child_meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = if !is_dir { child_meta.as_ref().map(|m| m.len()) } else { None };
            let allocated = if !is_dir { size.map(|s| get_allocated_size(&child_path, s)) } else { None };
            
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

        let _ = app_handle.emit("folder-structure-updated", StructureUpdate {
            path: normalize_path_string(&path.to_string_lossy()),
            children,
        });
    }
}

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

    // Linux-specific: Ignore /proc, /sys, /dev, /run, /tmp
    #[cfg(all(unix, not(target_os = "macos")))]
    let is_ignored_path = |p: &Path| -> bool {
        let path_str = p.to_string_lossy();
        if path_str.starts_with("/proc") || 
           path_str.starts_with("/sys") || 
           path_str.starts_with("/dev") ||
           path_str.starts_with("/run") {
            return true;
        }
        false
    };

    // macOS-specific: Ignore /System/Volumes to avoid duplicates
    #[cfg(target_os = "macos")]
    let is_ignored_path = {
        let filter_root = root_path_buf.clone();
        move |p: &Path| -> bool {
            if p.starts_with("/dev") { return true; }
            if p.starts_with("/System/Volumes") {
                // Only ignore if we are not scanning inside it
                if filter_root.starts_with("/System/Volumes") {
                    return false;
                }
                return true;
            }
            false
        }
    };

    #[cfg(not(unix))]
    let is_ignored_path = |_: &Path| -> bool { false };

    // Phase 1: Rapid structure scan for depth 1 and 2 (BFS-like)
    // 快速扫描前两层目录结构，以便前端能尽快展示目录树，无需等待深度扫描完成
    // Rapidly scan structure for depth 1 & 2 so frontend can show tree without waiting for deep scan
    if let Ok(entries) = fs::read_dir(&root_path_buf) {
        for entry in entries.flatten() {
             if let Ok(ft) = entry.file_type() {
                 if ft.is_dir() {
                     let p = entry.path();
                     if !is_ignored_path(&p) {
                        // Emit structure for this depth 1 dir (so we see depth 2 items)
                        scan_and_emit_structure(&p, &app_handle);
                        
                        // Also scan depth 2 dirs (so we see depth 3 items)
                        if let Ok(sub_entries) = fs::read_dir(&p) {
                            for sub in sub_entries.flatten() {
                                if let Ok(sub_ft) = sub.file_type() {
                                    if sub_ft.is_dir() {
                                        let sub_p = sub.path();
                                        if !is_ignored_path(&sub_p) {
                                            scan_and_emit_structure(&sub_p, &app_handle);
                                        }
                                    }
                                }
                            }
                        }
                     }
                 }
             }
        }
    }

    // Phase 2: Full Deep Scan (WalkDir)
    // 使用 WalkDir 进行深度优先遍历
    for entry in WalkDir::new(&root_path_buf)
        .into_iter()
        .filter_entry(|e| !is_ignored_path(e.path()))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        // let depth = entry.depth(); // Not needed for structure anymore
        
        // Double check for root path itself if it's one of the ignored paths
        if is_ignored_path(path) {
            continue;
        }

        let meta = match entry.metadata() {
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
        };

        if meta.is_dir() {
            let depth = entry.depth();
            // Phase 1 covers depth 0 (root) and depth 1 (immediate children).
            // We need to scan and emit structure for depth >= 1 to populate depth 2 and deeper.
            // Phase 1 覆盖了第 0 层（根）和第 1 层（直接子节点）。
            // 我们需要为 depth >= 1 扫描并发送结构，以填充第 2 层及更深层级。
            if depth >= 1 {
                 scan_and_emit_structure(&path, &app_handle);
            }

            // 确保目录在 map 中存在
            let p_str = normalize_path_string(&path.to_string_lossy());
            dir_stats.entry(p_str.clone()).or_insert((0, 0, 0, false));
            pending_updates.insert(p_str);
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
            emit_batch_updates(&app_handle, &dir_stats, &mut pending_updates);
            last_emit = Instant::now();
        }
    }

    // 最后发送剩余的更新并写入缓存
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
    for path_str in pending_updates.drain() {
        if let Some(stats) = dir_stats.get(&path_str) {
            let _ = app_handle.emit(
                "folder-size-updated",
                SizeUpdate {
                    path: path_str,
                    size: stats.0,
                    allocated_size: stats.1,
                    is_restricted: stats.3,
                    file_count: stats.2,
                },
            );
        }
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
                }
            }
        }

        // 如果缓存有值，优先使用缓存的统计数据；否则使用递归计算的初步数据
        let final_size = cached_size.or(Some(calculated_size));
        let final_allocated = cached_allocated.or(Some(calculated_allocated));
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
            open_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
