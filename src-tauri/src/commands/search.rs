//! 文件搜索命令。
//!
//! 该命令内部为同步的 WalkDir 全量遍历，故整体移入 `spawn_blocking`
//! 执行，避免阻塞异步运行时线程。

use std::path::PathBuf;
use regex::Regex;
use sysinfo::Disks;
use walkdir::WalkDir;

use crate::models::SearchResult;
use crate::utils::parse_size_str;

#[tauri::command]
pub async fn search_files(
    query: String,
    root_path: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
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
                Err(_) => return Err::<Vec<SearchResult>, String>("Invalid regex".to_string()),
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
    })
    .await
    .map_err(|e| format!("Search task failed: {}", e))?;

    result
}