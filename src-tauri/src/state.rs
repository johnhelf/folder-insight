use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

pub type SizeCache = Arc<Mutex<HashMap<String, (u64, u64, u64, bool)>>>;

/// 应用程序状态（全局共享）
pub struct AppState {
    /// 简单结果缓存：只存储最终计算结果
    /// Key: path, Value: (logical_size, allocated_size, file_count, is_restricted)
    pub size_cache: SizeCache,
    /// 进行中的计算集合，用于避免重复启动后台计算
    pub in_progress: Arc<Mutex<HashSet<String>>>,
    /// 磁盘分区到物理磁盘的映射 (Drive Letter -> Disk Number)
    pub disk_map: Arc<Mutex<HashMap<String, u32>>>,
    /// 物理磁盘的并发锁 (Disk Number -> Mutex)
    pub disk_locks: Arc<Mutex<HashMap<u32, Arc<Mutex<()>>>>>,
    /// 当前扫描的取消令牌
    pub current_scan_cancel_token: Arc<Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>>,
    /// AI分析扫描的取消令牌
    pub ai_scan_cancel_token: Arc<Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>>,
}
