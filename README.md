# 文件夹洞察 (Folder Insight)

[简体中文](#简体中文) | [English](#english)

---

<a name="简体中文"></a>
## 简体中文

一个基于 **Tauri v2** + **React** + **Rust** 构建的高性能本地文件夹分析工具。它可以帮助你快速扫描磁盘空间，直观地找出占用空间最大的文件夹。

### ✨ 功能特性

- 🚀 **极速扫描**：后端采用 Rust 编写，利用 **Rayon** 并行递归算法，能够充分利用多核 CPU 性能，秒级完成大容量文件夹的扫描与大小统计。
- 📊 **可视化统计**：
  - **树形视图**：支持目录树懒加载，清晰展示文件层级结构。
  - **统计图表**：内置饼图分析，直观展示子文件夹的空间占用比例。
- ⏱️ **实时反馈**：
  - 扫描进度实时推送到前端，顶部汇总数据（总大小、文件数）动态更新。
  - 针对大型目录，提供“计算中...”状态提示，不阻塞用户操作。
- 🛡️ **稳定鲁棒**：
  - 内置 Panic 捕获与自愈机制，即使遇到特殊权限或损坏文件，扫描也能持续进行而不卡死。
  - 路径标准化处理，兼容各种文件系统路径差异。
- 🖱️ **便捷交互**：
  - 右键菜单支持“在文件资源管理器中打开”。
  - 响应式布局，支持窗口自适应调整。

### 🛠️ 技术栈

- **前端**: React 19, TypeScript, Tailwind CSS
- **后端**: Rust, Tauri v2
- **并行计算**: Rayon
- **图标**: Lucide React
- **图表**: Recharts

### 🚀 快速开始

#### 前置要求

- 安装 [Node.js](https://nodejs.org/)
- 安装 [Rust 编译环境](https://www.rust-lang.org/tools/install)
- 安装 [Tauri 依赖](https://tauri.app/v1/guides/getting-started/prerequisites)

#### 运行步骤

1. 克隆项目并进入目录：
   ```bash
   git clone <repository-url>
   cd folder-insight
   ```

2. 安装前端依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm run tauri dev
   ```

---

<a name="english"></a>
## English

A high-performance local folder analysis tool built with **Tauri v2** + **React** + **Rust**. It helps you quickly scan disk space and intuitively find the largest folders.

### ✨ Features

- 🚀 **Blazing Fast Scanning**: The backend is written in Rust, utilizing the **Rayon** parallel recursive algorithm to fully leverage multi-core CPU performance, completing scans and size statistics of large folders in seconds.
- 📊 **Visual Statistics**:
  - **Tree View**: Supports lazy loading of directory trees, clearly displaying the file hierarchy.
  - **Statistical Charts**: Built-in pie chart analysis to intuitively show the space usage proportion of subfolders.
- ⏱️ **Real-time Feedback**:
  - Scanning progress is pushed to the frontend in real-time, with top summary data (total size, file count) updating dynamically.
  - For large directories, a "Calculating..." status hint is provided without blocking user operations.
- 🛡️ **Stable & Robust**:
  - Built-in Panic capture and self-healing mechanism ensure scanning continues even when encountering special permissions or corrupted files.
  - Path normalization handles various file system path differences.
- 🖱️ **Convenient Interaction**:
  - Context menu supports "Open in File Explorer".
  - Responsive layout with window auto-adaptation.

### 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Backend**: Rust, Tauri v2
- **Parallel Computing**: Rayon
- **Icons**: Lucide React
- **Charts**: Recharts

### 🚀 Quick Start

#### Prerequisites

- Install [Node.js](https://nodejs.org/)
- Install [Rust Environment](https://www.rust-lang.org/tools/install)
- Install [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

#### Steps

1. Clone the repository and enter the directory:
   ```bash
   git clone <repository-url>
   cd FolderExplorer
   ```

2. Install frontend dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run tauri dev
   ```

### 📝 License

MIT License
