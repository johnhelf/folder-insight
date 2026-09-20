//! 前端命令入口聚合模块。
//!
//! 按业务域拆分为多个子模块。`#[tauri::command]` 宏会在各定义模块内生成
//! 隐藏的 `__cmd__xxx` 辅助项，因此 `lib.rs` 的 `tauri::generate_handler!`
//! 必须引用具体子模块路径（如 `commands::scan::analyze_directory`），
//! 而不能仅在此处做一层 `pub use` 重导出。

pub mod ai;
pub mod disks;
pub mod duplicates;
pub mod large;
pub mod scan;
pub mod search;