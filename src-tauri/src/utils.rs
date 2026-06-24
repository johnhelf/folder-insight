use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};
use std::fs::File;
#[cfg(unix)]
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use xxhash_rust::xxh3::Xxh3;
use std::sync::{Arc, Mutex};
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::models::{StructureUpdate, BatchStructureUpdate, SizeUpdate, BatchSizeUpdate};
use crate::state::SizeCache;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 创建一个不会显示控制台窗口的 Command（Windows 专用）
#[cfg(target_os = "windows")]
fn create_hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 获取 Windows 下的磁盘分区映射 (Drive Letter -> Disk Number)
#[cfg(target_os = "windows")]
pub fn get_disk_partition_map() -> HashMap<String, u32> {
    let mut map = HashMap::new();
    // Execute PowerShell command to get partition mapping
    // Get-Partition | Select-Object DriveLetter, DiskNumber | ConvertTo-Json
    let output = create_hidden_command("powershell")
        .args(&["-NoProfile", "-Command", "Get-Partition | Select-Object DriveLetter, DiskNumber | ConvertTo-Json"])
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let json_str = String::from_utf8_lossy(&output.stdout);
            // Parse JSON. It can be an object or an array of objects.
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(arr) = json.as_array() {
                    for item in arr {
                        // DriveLetter is usually a char code in some PS versions, but Select-Object usually returns the char itself if formatted.
                        // Actually Get-Partition returns a char for DriveLetter.
                        // However, ConvertTo-Json might serialize it as a number (char code) or string.
                        // Let's handle both.
                        let letter = if let Some(l) = item["DriveLetter"].as_str() {
                            l.to_string()
                        } else if let Some(l) = item["DriveLetter"].as_u64() {
                            // If it's a char code (0 is null)
                            if l == 0 { String::new() } else { char::from_u32(l as u32).unwrap_or_default().to_string() }
                        } else {
                            String::new()
                        };

                        let disk_num = item["DiskNumber"].as_u64();

                        if !letter.is_empty() && letter != "\0" && disk_num.is_some() {
                             map.insert(format!("{}:", letter), disk_num.unwrap() as u32);
                        }
                    }
                } else if let Some(obj) = json.as_object() {
                    let letter = if let Some(l) = obj["DriveLetter"].as_str() {
                        l.to_string()
                    } else if let Some(l) = obj["DriveLetter"].as_u64() {
                        if l == 0 { String::new() } else { char::from_u32(l as u32).unwrap_or_default().to_string() }
                    } else {
                        String::new()
                    };
                    
                    let disk_num = obj["DiskNumber"].as_u64();

                    if !letter.is_empty() && letter != "\0" && disk_num.is_some() {
                        map.insert(format!("{}:", letter), disk_num.unwrap() as u32);
                    }
                }
            }
        }
    }
    map
}

#[cfg(not(target_os = "windows"))]
pub fn get_disk_partition_map() -> HashMap<String, u32> {
    HashMap::new()
}

/// 格式化字节数为人类可读字符串
pub fn format_size(size: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if size >= TB {
        format!("{:.2} TB", size as f64 / TB as f64)
    } else if size >= GB {
        format!("{:.2} GB", size as f64 / GB as f64)
    } else if size >= MB {
        format!("{:.2} MB", size as f64 / MB as f64)
    } else if size >= KB {
        format!("{:.2} KB", size as f64 / KB as f64)
    } else {
        format!("{} B", size)
    }
}
pub fn normalize_path_string(path: &str) -> String {
    PathBuf::from(path)
        .components()
        .collect::<PathBuf>()
        .to_string_lossy()
        .to_string()
}

#[cfg(target_os = "windows")]
pub fn get_allocated_size(path: &Path, logical_size: u64) -> u64 {
    use std::os::windows::ffi::OsStrExt;

    if logical_size == 0 {
        return 0;
    }

    let mut wide_path: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide_path.push(0);

    let mut high: u32 = 0;
    extern "system" {
        fn GetCompressedFileSizeW(lpFileName: *const u16, lpFileSizeHigh: *mut u32) -> u32;
        fn GetLastError() -> u32;
    }

    let low = unsafe { GetCompressedFileSizeW(wide_path.as_ptr(), &mut high) };
    
    let mut actual_size = logical_size;
    if low == 0xFFFFFFFF {
        let err = unsafe { GetLastError() };
        if err == 0 {
            actual_size = ((high as u64) << 32) | (low as u64);
        }
    } else {
        actual_size = ((high as u64) << 32) | (low as u64);
    }

    if actual_size == 0 {
        return 0;
    }

    const CLUSTER_SIZE: u64 = 4096;
    actual_size.div_ceil(CLUSTER_SIZE) * CLUSTER_SIZE
}

#[cfg(target_os = "windows")]
pub fn get_file_id_and_links(path: &Path) -> Option<(u64, u32)> {
    use std::os::windows::ffi::OsStrExt;
    
    let mut wide_path: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide_path.push(0);

    type HANDLE = *mut std::ffi::c_void;
    const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
    const FILE_SHARE_READ: u32 = 0x00000001;
    const FILE_SHARE_WRITE: u32 = 0x00000002;
    const FILE_SHARE_DELETE: u32 = 0x00000004;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x02000000;

    #[repr(C)]
    struct FILETIME {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }

    #[repr(C)]
    struct BY_HANDLE_FILE_INFORMATION {
        dw_file_attributes: u32,
        ft_creation_time: FILETIME,
        ft_last_access_time: FILETIME,
        ft_last_write_time: FILETIME,
        dw_volume_serial_number: u32,
        n_file_size_high: u32,
        n_file_size_low: u32,
        n_number_of_links: u32,
        n_file_index_high: u32,
        n_file_index_low: u32,
    }

    extern "system" {
        fn CreateFileW(
            lpFileName: *const u16,
            dwDesiredAccess: u32,
            dwShareMode: u32,
            lpSecurityAttributes: *mut std::ffi::c_void,
            dwCreationDisposition: u32,
            dwFlagsAndAttributes: u32,
            hTemplateFile: HANDLE,
        ) -> HANDLE;
        fn GetFileInformationByHandle(
            hFile: HANDLE,
            lpFileInformation: *mut BY_HANDLE_FILE_INFORMATION,
        ) -> i32;
        fn CloseHandle(hObject: HANDLE) -> i32;
    }

    unsafe {
        // dwDesiredAccess = 0 means query attributes without reading the file
        let handle = CreateFileW(
            wide_path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        );

        if handle == INVALID_HANDLE_VALUE {
            return None;
        }

        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        let res = GetFileInformationByHandle(handle, &mut info);
        CloseHandle(handle);

        if res != 0 {
            let file_id = ((info.n_file_index_high as u64) << 32) | (info.n_file_index_low as u64);
            return Some((file_id, info.n_number_of_links));
        }
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_allocated_size(path: &Path, logical_size: u64) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = fs::symlink_metadata(path) {
            return meta.blocks() * 512;
        }
    }
    logical_size
}

/// 判断路径是否应该被忽略（如 Linux 下的虚拟/挂载文件夹）
#[allow(unused_variables)]
pub fn is_ignored_path(p: &Path, root_path: &Path) -> bool {
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

pub fn emit_batch_structure_updates(
    app_handle: &AppHandle,
    pending_structures: &mut Vec<StructureUpdate>,
) {
    if pending_structures.is_empty() {
        return;
    }

    let all_updates = std::mem::take(pending_structures);
    
    let mut current_batch = Vec::new();
    let mut current_nodes_count = 0;
    
    for update in all_updates {
        let nodes_in_update = update.children.len();
        current_batch.push(update);
        current_nodes_count += nodes_in_update;
        
        // Emit if we reach ~5000 nodes total, or 50 updates (prevent huge IPC payloads)
        if current_nodes_count > 5000 || current_batch.len() >= 50 {
            let batch = BatchStructureUpdate {
                updates: std::mem::take(&mut current_batch),
            };
            let _ = app_handle.emit("folder-structure-batch-updated", batch);
            current_nodes_count = 0;
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    
    if !current_batch.is_empty() {
        let batch = BatchStructureUpdate {
            updates: current_batch,
        };
        let _ = app_handle.emit("folder-structure-batch-updated", batch);
    }
}

pub fn emit_batch_updates(
    app_handle: &AppHandle,
    dir_stats: &HashMap<String, (u64, u64, u64, bool)>,
    pending_updates: &mut HashSet<String>,
) {
    let mut batch: Vec<SizeUpdate> = Vec::with_capacity(1000);
    
    for path_str in pending_updates.drain() {
        if let Some(stats) = dir_stats.get(&path_str) {
            batch.push(SizeUpdate {
                path: path_str,
                size: stats.0,
                allocated_size: stats.1,
                is_restricted: stats.3,
                file_count: stats.2,
            });

            if batch.len() >= 1000 {
                let _ = app_handle.emit("folder-size-batch-updated", BatchSizeUpdate { updates: std::mem::take(&mut batch) });
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }

    if !batch.is_empty() {
        let _ = app_handle.emit("folder-size-batch-updated", BatchSizeUpdate { updates: batch });
    }
}

/// 判断是否需要启动后台计算
pub fn try_mark_in_progress(
    normalized_path: &str,
    _cache: &SizeCache,
    in_progress: &Arc<Mutex<HashSet<String>>>,
) -> bool {
    // 移除缓存检查，确保每次请求（特别是刷新时）都重新启动扫描，
    // 否则如果缓存命中，后台任务不会启动，导致深层结构更新（folder-structure-updated）无法发送，
    // 前端将永远只显示初始的 2 层结构。
    
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

pub fn compute_file_hash(path: &Path, partial: bool) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Xxh3::new();
    
    if partial {
        // Read first 8KB, middle 8KB, and last 8KB
        let file_size = file.metadata()?.len();
        let chunk_size = 8192.min(file_size);
        let mut buffer = vec![0; chunk_size as usize];
        
        // Start
        file.read_exact(&mut buffer)?;
        hasher.update(&buffer);
        
        if file_size > chunk_size * 2 {
            // Middle
            file.seek(SeekFrom::Start(file_size / 2))?;
            file.read_exact(&mut buffer)?;
            hasher.update(&buffer);
            
            // End
            file.seek(SeekFrom::End(-(chunk_size as i64)))?;
            file.read_exact(&mut buffer)?;
            hasher.update(&buffer);
        }
    } else {
        // Full hash
        let mut buffer = [0; 65536];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
        }
    }
    
    Ok(format!("{:x}", hasher.digest()))
}

pub fn get_disk_number(path: &Path) -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy().to_string();
        let mut drive_letter = String::new();

        // Handle standard paths "C:\..."
        if path_str.len() >= 2 && &path_str[1..2] == ":" {
             if let Some(c) = path_str.chars().next() {
                 if c.is_ascii_alphabetic() {
                     drive_letter = c.to_string();
                 }
             }
        }
        // Handle UNC paths "\\?\C:\..." or "\\.\C:\"
        else if path_str.starts_with("\\\\?\\") || path_str.starts_with("\\\\.\\") {
             if path_str.len() >= 6 && &path_str[5..6] == ":" {
                 if let Some(c) = path_str.chars().nth(4) {
                      if c.is_ascii_alphabetic() {
                         drive_letter = c.to_string();
                      }
                 }
             }
        }

        if !drive_letter.is_empty() {
                 let output = create_hidden_command("powershell")
                    .args(&["-NoProfile", "-Command", &format!("Get-Partition -DriveLetter {} | Select-Object -ExpandProperty DiskNumber", drive_letter)])
                    .output()
                    .ok()?;
                
                if output.status.success() {
                    let s = String::from_utf8_lossy(&output.stdout);
                    return s.trim().parse::<u32>().ok();
                }
        }
    }
    // For other OS or failure, return None (no locking based on physical disk)
    None
}

pub fn parse_size_str(s: &str) -> Option<u64> {
    let s = s.trim().to_uppercase();
    let mut multiplier = 1;
    let mut num_str = s.clone();

    if s.ends_with("GB") {
        multiplier = 1024 * 1024 * 1024;
        num_str = s[..s.len()-2].to_string();
    } else if s.ends_with("MB") {
        multiplier = 1024 * 1024;
        num_str = s[..s.len()-2].to_string();
    } else if s.ends_with("KB") {
        multiplier = 1024;
        num_str = s[..s.len()-2].to_string();
    } else if s.ends_with('B') {
        num_str = s[..s.len()-1].to_string();
    }

    num_str.trim().parse::<u64>().ok().map(|n| n * multiplier)
}

