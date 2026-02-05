use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// 应用程序状态（全局共享）
/// App state (shared globally)
struct AppState {
    /// 简单结果缓存：只存储最终计算结果
    /// Simple result cache: stores final results only
    /// Key: path, Value: (logical_size, allocated_size, file_count, is_restricted)
    size_cache: Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>,
    /// 进行中的计算集合，用于避免重复启动后台计算
    /// In-progress set to prevent duplicated background computations
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
    is_restricted: bool, // 新增：是否受限 / New: whether it's restricted
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

/// 规范化路径字符串，避免缓存 key 因路径写法不同而不一致
/// Normalize a path string to keep cache keys consistent across different representations.
fn normalize_path_string(path: &str) -> String {
    std::path::PathBuf::from(path)
        .components()
        .collect::<std::path::PathBuf>()
        .to_string_lossy()
        .to_string()
}

/// 在资源管理器中打开指定路径
/// Open the given path in OS file explorer.
#[tauri::command]
async fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let path_buf = std::path::PathBuf::from(&path);

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

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Not supported on this OS".to_string());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn get_allocated_size(_path: &Path, logical_size: u64) -> u64 {
    // Windows 上 meta.len() 通常就是逻辑大小。
    // 实际占用空间（Allocated Size）通常按簇（Cluster）对齐。
    // 为了精确，我们可以使用 GetCompressedFileSizeW 处理压缩文件。
    // 但作为通用方案，按 4KB 簇对齐是一个合理的估算。
    const CLUSTER_SIZE: u64 = 4096;
    if logical_size == 0 {
        return 0;
    }
    ((logical_size + CLUSTER_SIZE - 1) / CLUSTER_SIZE) * CLUSTER_SIZE
}

#[cfg(not(target_os = "windows"))]
fn get_allocated_size(path: &Path, logical_size: u64) -> u64 {
    // Unix 系系统通常支持获取 blocks
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = fs::symlink_metadata(path) {
            return meta.blocks() * 512;
        }
    }
    logical_size
}

/// 递归计算目录大小（并行版），并通过事件实时回传结果
/// Recursively compute directory size in parallel and emit realtime updates via events.
fn compute_dir_size_recursive(
    path_str: String,
    cache: Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>,
    app_handle: AppHandle,
    depth: usize,
) -> (u64, u64, u64, bool) {
    // 限制递归深度，防止极深目录导致栈溢出
    // Limit recursion depth to prevent stack overflow in extremely deep directories
    if depth > 500 {
        return (0, 0, 0, true);
    }

    let normalized_current = normalize_path_string(&path_str);
    {
        let cache_lock = cache.lock().unwrap();
        if let Some(res) = cache_lock.get(&normalized_current) {
            return *res;
        }
    }

    let path_obj = Path::new(&normalized_current);
    let mut total_size = 0;
    let mut total_allocated = 0;
    let mut total_count = 0;
    let mut subdirs = Vec::new();
    let mut is_restricted = false;

    match fs::read_dir(path_obj) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let meta = match fs::symlink_metadata(&entry_path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                if meta.is_dir() {
                    subdirs.push(entry_path.to_string_lossy().to_string());
                } else {
                    let size = meta.len();
                    total_size += size;
                    total_allocated += get_allocated_size(&entry_path, size);
                    total_count += 1;
                }
            }
        }
        Err(_) => {
            is_restricted = true;
        }
    }

    let results: Vec<(u64, u64, u64, bool)> = subdirs
        .par_iter()
        .map(|subdir| {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                compute_dir_size_recursive(subdir.clone(), cache.clone(), app_handle.clone(), depth + 1)
            }));

            match result {
                Ok(res) => res,
                Err(_) => {
                    eprintln!("Panic processing subdir: {}", subdir);
                    (0, 0, 0, true)
                }
            }
        })
        .collect();

    for (s, a, c, r) in results {
        total_size += s;
        total_allocated += a;
        total_count += c;
        if r {
            is_restricted = true;
        }
    }

    {
        let mut cache_lock = cache.lock().unwrap();
        cache_lock.insert(normalized_current.clone(), (total_size, total_allocated, total_count, is_restricted));
    }

    let _ = app_handle.emit(
        "folder-size-updated",
        SizeUpdate {
            path: normalized_current,
            size: total_size,
            allocated_size: total_allocated,
            is_restricted,
            file_count: total_count,
        },
    );

    (total_size, total_allocated, total_count, is_restricted)
}

/// 判断是否需要启动后台计算，并在需要时标记为 in-progress
/// Decide whether to start a background computation and mark it as in-progress when needed.
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
/// Quickly scan the directory structure and start background size computations.
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

    // 如果没有子目录，我们可以立即得出当前目录的总大小，无需启动后台任务
    // If there are no subdirectories, we can immediately determine the total size.
    if !has_subdirs {
        let mut cache = state.size_cache.lock().unwrap();
        cache.insert(
            root_path.clone(),
            (current_dir_base_size, current_dir_base_allocated_size, current_dir_file_count, false),
        );
    }

    // 目录优先，其次按大小降序（None 视为 0），最后按名称
    // Folders first, then size desc (None as 0), then by name
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
            .stack_size(8 * 1024 * 1024) // 8MB 栈大小 / 8MB stack size
            .spawn(move || {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    compute_dir_size_recursive(root_to_compute.clone(), cache, app_handle, 0);
                }));

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
            // 缓存仅用于加速
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
