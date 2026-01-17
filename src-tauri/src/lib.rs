use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

/// 应用程序状态（全局共享）
/// App state (shared globally)
struct AppState {
    /// 简单结果缓存：只存储最终计算结果
    /// Simple result cache: stores final results only
    /// Key: path, Value: (size, file_count)
    size_cache: Arc<Mutex<HashMap<String, (u64, u64)>>>,
    /// 进行中的计算集合，用于避免重复启动后台计算
    /// In-progress set to prevent duplicated background computations
    in_progress: Arc<Mutex<HashSet<String>>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileNode {
    name: String,
    path: String,
    size: Option<u64>, // None 表示“计算中” / None means "calculating"
    base_size: u64,    // 当前目录下直接文件大小总和 / Direct files total size
    is_dir: bool,
    file_count: u64,
    children: Option<Vec<FileNode>>,
}

#[derive(Serialize, Clone, Debug)]
struct SizeUpdate {
    path: String,
    size: u64,
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

/// 递归计算目录大小（并行版），并通过事件实时回传结果
/// Recursively compute directory size in parallel and emit realtime updates via events.
fn compute_dir_size_recursive(
    path_str: String,
    cache: Arc<Mutex<HashMap<String, (u64, u64)>>>,
    app_handle: AppHandle,
) -> (u64, u64) {
    {
        let cache_lock = cache.lock().unwrap();
        if let Some(res) = cache_lock.get(&path_str) {
            return *res;
        }
    }

    let path_obj = Path::new(&path_str);
    let mut total_size = 0;
    let mut total_count = 0;
    let mut subdirs = Vec::new();

    if let Ok(entries) = fs::read_dir(path_obj) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let meta = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            if meta.is_dir() {
                subdirs.push(entry_path.to_string_lossy().to_string());
            } else {
                total_size += meta.len();
                total_count += 1;
            }
        }
    }

    let results: Vec<(u64, u64)> = subdirs
        .par_iter()
        .map(|subdir| {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                compute_dir_size_recursive(subdir.clone(), cache.clone(), app_handle.clone())
            }));

            match result {
                Ok(res) => res,
                Err(_) => {
                    eprintln!("Panic processing subdir: {}", subdir);
                    let _ = app_handle.emit(
                        "folder-size-updated",
                        SizeUpdate {
                            path: subdir.clone(),
                            size: 0,
                            file_count: 0,
                        },
                    );
                    (0, 0)
                }
            }
        })
        .collect();

    for (s, c) in results {
        total_size += s;
        total_count += c;
    }

    {
        let mut cache_lock = cache.lock().unwrap();
        cache_lock.insert(path_str.clone(), (total_size, total_count));
    }

    let _ = app_handle.emit(
        "folder-size-updated",
        SizeUpdate {
            path: path_str,
            size: total_size,
            file_count: total_count,
        },
    );

    (total_size, total_count)
}

/// 判断是否需要启动后台计算，并在需要时标记为 in-progress
/// Decide whether to start a background computation and mark it as in-progress when needed.
fn try_mark_in_progress(
    normalized_path: &str,
    cache: &Arc<Mutex<HashMap<String, (u64, u64)>>>,
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

    if let Ok(entries) = fs::read_dir(path_obj) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let meta = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let is_dir = meta.is_dir();
            let path_str = entry_path.to_string_lossy().to_string();
            let file_size = if is_dir { 0 } else { meta.len() };

            let mut size = if is_dir { None } else { Some(file_size) };
            let mut file_count = if is_dir { 0 } else { 1 };

            let node_base_size = if is_dir {
                0
            } else {
                current_dir_base_size += file_size;
                file_size
            };

            if is_dir {
                let cache_hit = {
                    let cache = state.size_cache.lock().unwrap();
                    cache.get(&path_str).cloned()
                };

                if let Some((cached_size, cached_count)) = cache_hit {
                    size = Some(cached_size);
                    file_count = cached_count;
                }
            }

            children.push(FileNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path_str,
                size,
                base_size: node_base_size,
                is_dir,
                file_count,
                children: None,
            });
        }
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

        thread::spawn(move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                compute_dir_size_recursive(root_to_compute.clone(), cache, app_handle);
            }));

            let mut in_progress = in_progress.lock().unwrap();
            in_progress.remove(&root_to_compute);
        });
    }

    let name = path_obj
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root_path.clone());

    let (root_size, root_count) = {
        let cache = state.size_cache.lock().unwrap();
        if let Some((s, c)) = cache.get(&root_path) {
            (Some(*s), *c)
        } else {
            (None, 0)
        }
    };

    Ok(FileNode {
        name,
        path: root_path,
        size: root_size,
        base_size: current_dir_base_size,
        is_dir: true,
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
