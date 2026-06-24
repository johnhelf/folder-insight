use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
    pub allocated_size: Option<u64>,
    pub base_size: u64,
    pub base_allocated_size: u64,
    pub is_dir: bool,
    pub is_restricted: bool,
    pub file_count: u64,
    pub children: Option<Vec<FileNode>>,
    pub modified: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SizeUpdate {
    pub path: String,
    pub size: u64,
    pub allocated_size: u64,
    pub is_restricted: bool,
    pub file_count: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct StructureUpdate {
    pub path: String,
    pub children: Vec<FileNode>,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatchSizeUpdate {
    pub updates: Vec<SizeUpdate>,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatchStructureUpdate {
    pub updates: Vec<StructureUpdate>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProgressUpdate {
    pub scanned_count: u64,
    pub scanned_size: u64,
    pub scanned_allocated_size: u64,
    pub current_path: String,
    pub disk_name: Option<String>,
    pub total_size: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiskStats {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub mount_point: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PhysicalDisk {
    pub number: u32,
    pub name: String,
    pub partitions: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DuplicateScanProgress {
    pub phase: String,
    pub total_files: u64,
    pub processed_files: u64,
    pub current_path: String,
}

#[derive(Deserialize, Debug)]
pub struct DuplicateScanOptions {
    pub min_size: u64,
    pub max_size: Option<u64>,
    pub included_extensions: Option<Vec<String>>,
    pub target_dirs: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LargeFileInfo {
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub extension: String,
    pub last_accessed: u64,
    pub last_modified: u64,
    pub children_summary: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AIReportResult {
    pub path: String,
    pub reason: String,
    pub action: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}
