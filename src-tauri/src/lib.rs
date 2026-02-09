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

    // 使用 WalkDir 进行深度优先遍历
    for entry in WalkDir::new(&root_path_buf)
        .into_iter()
        .filter_entry(|e| !is_ignored_path(e.path()))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        
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

        if !meta.is_dir() {
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
        } else {
            // 确保目录在 map 中存在
            let p_str = normalize_path_string(&path.to_string_lossy());
            dir_stats.entry(p_str.clone()).or_insert((0, 0, 0, false));
            pending_updates.insert(p_str);
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
    cache: &Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>,
    in_progress: &Arc<Mutex<HashSet<String>>>,
) -> bool {
    let cache_hit = {
        let cache = cache.lock().unwrap();
        cache.get(normalized_path).is_some()
    };
    if cache_hit {
        return false;
    }

    let mut in_progress = in_progress.lock().unwrap();
    if in_progress.contains(normalized_path) {
        return false;
    }

    in_progress.insert(normalized_path.to_string());
    true
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
    let mut children = Vec::new();
    let mut current_dir_base_size: u64 = 0;
    let mut current_dir_base_allocated_size: u64 = 0;
    let mut has_subdirs = false;
    let mut current_dir_file_count = 0;

    if let Ok(entries) = fs::read_dir(path_obj) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_dir = meta.is_dir();
            if is_dir {
                has_subdirs = true;
            }
            let normalized_child = normalize_path_string(&entry_path.to_string_lossy());

            let (size, allocated_size, count, is_restricted) = if is_dir {
                let cache_lock = state.size_cache.lock().unwrap();
                if let Some(res) = cache_lock.get(&normalized_child) {
                    (Some(res.0), Some(res.1), res.2, res.3)
                } else {
                    (None, None, 0, false)
                }
            } else {
                let s = meta.len();
                let a = get_allocated_size(&entry_path, s);
                (Some(s), Some(a), 1, false)
            };

            if !is_dir {
                current_dir_base_size += size.unwrap_or(0);
                current_dir_base_allocated_size += allocated_size.unwrap_or(0);
                current_dir_file_count += 1;
            }

            children.push(FileNode {
                name,
                path: normalized_child,
                size,
                allocated_size,
                base_size: if is_dir { 0 } else { size.unwrap_or(0) },
                base_allocated_size: if is_dir { 0 } else { allocated_size.unwrap_or(0) },
                is_dir,
                is_restricted,
                file_count: count,
                children: None,
            });
        }
    }

    if !has_subdirs {
        let mut cache = state.size_cache.lock().unwrap();
        cache.insert(
            root_path.clone(),
            (current_dir_base_size, current_dir_base_allocated_size, current_dir_file_count, false),
        );
    }

    children.sort_by(|a, b| {
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

    let should_compute_root =
        try_mark_in_progress(&root_path, &state.size_cache, &state.in_progress);

    if should_compute_root {
        let cache = state.size_cache.clone();
        let in_progress = state.in_progress.clone();
        let app_handle = app.clone();
        let root_to_compute = root_path.clone();

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

    let name = path_obj
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root_path.clone());

    let (root_size, root_allocated, root_count, root_restricted) = {
        let cache = state.size_cache.lock().unwrap();
        if let Some(res) = cache.get(&root_path) {
            (Some(res.0), Some(res.1), res.2, res.3)
        } else {
            (None, None, current_dir_file_count, false)
        }
    };

    Ok(FileNode {
        name,
        path: root_path,
        size: root_size,
        allocated_size: root_allocated,
        base_size: current_dir_base_size,
        base_allocated_size: current_dir_base_allocated_size,
        is_dir: true,
        is_restricted: root_restricted,
        file_count: root_count,
        children: Some(children),
    })
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
