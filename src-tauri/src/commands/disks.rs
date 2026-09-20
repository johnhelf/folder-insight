//! 磁盘与系统操作相关命令：在资源管理器中打开、物理磁盘与磁盘空间统计。

use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use sysinfo::Disks;

use crate::models::{DiskStats, PhysicalDisk};

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