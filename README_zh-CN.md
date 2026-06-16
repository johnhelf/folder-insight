# 文件夹洞察 (Folder Insight)

[English](./README.md)

---

一个基于 **Tauri v2** + **React** + **Rust** 构建的高性能本地文件夹分析工具。它可以帮助你快速扫描磁盘空间，直观地找出占用空间最大的文件夹，并提供 AI 智能分析与清理建议。

## ✨ 功能特性

- 🚀 **极速扫描**：后端采用 Rust 编写，利用 **多线程** 并行算法，能够充分利用多核 CPU 性能，秒级完成大容量文件夹的扫描与大小统计。
- 📊 **多维可视化**：
  - **树形视图**：支持目录树懒加载，清晰展示文件层级结构。
  - **统计图表**：内置饼图、**旭日图 (Sunburst)** 和 **矩形树图 (Treemap)**，多维度直观展示空间占用比例。
- 🤖 **AI 智能分析**：
  - 基于本地 LLM 或云端 API 对扫描结果进行深度分析。
  - 提供智能清理建议、文件分类整理方案，帮助你更高效地管理磁盘空间。
- 👯 **重复文件检测**：
  - 快速扫描并识别重复文件（基于哈希或文件名/大小）。
  - 提供便捷的清理选项，释放冗余空间。
- 📑 **文件类型统计**：
  - 按文件扩展名分类统计，一目了然地看到哪种类型的文件占用了最多空间。
- ⏱️ **实时反馈**：
  - 扫描进度实时推送到前端，顶部汇总数据（总大小、文件数）动态更新。
  - 针对大型目录，提供“计算中...”状态提示，不阻塞用户操作。
- 🛡️ **稳定鲁棒**：
  - 内置 Panic 捕获与自愈机制，即使遇到特殊权限或损坏文件，扫描也能持续进行而不卡死。
  - 路径标准化处理，兼容各种文件系统路径差异。
- 🖱️ **便捷交互**：
  - 支持 **拖拽文件夹** 进行快速分析。
  - 右键菜单支持“在文件资源管理器中打开”。
  - 响应式布局，支持窗口自适应调整。
  - **多语言支持**：内置中英文切换，满足不同用户需求。

## 🛠️ 技术栈

- **前端**: React 19, TypeScript, Tailwind CSS, Framer Motion
- **后端**: Rust, Tauri v2
- **核心库**: 
  - `walkdir`: 高效的文件系统遍历
  - `sysinfo`: 系统信息获取
  - `sha2`: 文件哈希计算
  - `regex`: 正则表达式匹配
- **图表**: Recharts, D3.js, ECharts
- **图标**: Lucide React

## ☕ 赞助项目

如果您觉得这个项目对您有帮助，或者您喜欢我的工作，欢迎请我喝一杯咖啡！您的支持是我持续维护和改进项目的动力。

### 支付宝 (Alipay)

<img src="public/sponsor-qr.png" alt="Alipay QR Code" width="200" />

### Buy Me a Coffee

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/johnhelf)

## 🚀 快速开始

### 前置要求

- 安装 [Node.js](https://nodejs.org/)
- 安装 [Rust 编译环境](https://www.rust-lang.org/tools/install)
- 安装 [Tauri 依赖](https://tauri.app/v1/guides/getting-started/prerequisites)

### 运行步骤

1. 克隆项目并进入目录：
   ```bash
   git clone <repository-url>
   cd FolderExplorer
   ```

2. 安装前端依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm run tauri dev
   ```

4. 构建生产版本：
   ```bash
   npm run tauri build
   ```

## 📝 License

MIT License
