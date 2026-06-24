# Folder Insight

[简体中文](./README_zh-CN.md)

---

A high-performance local folder analysis tool built with **Tauri v2** + **React** + **Rust**. It helps you quickly scan disk space, intuitively find the largest folders, and provides AI-powered analysis and cleanup suggestions.

## ✨ Features

- 🚀 **Blazing Fast Scanning**: The backend is written in Rust, utilizing **Multi-threaded** parallel algorithms to fully leverage multi-core CPU performance, completing scans and size statistics of large folders in seconds.
- 📊 **Multi-dimensional Visualization**:
  - **Tree View**: Supports lazy loading of directory trees, clearly displaying the file hierarchy.
  - **Statistical Charts**: Built-in Pie Chart, **Sunburst Chart**, and **Treemap** for multi-dimensional space usage display.
- 🤖 **AI Insights**:
  - Deep analysis of scan results based on local LLM or cloud API.
  - Provides intelligent cleanup suggestions and file organization plans to help you manage disk space more efficiently.
- 👯 **Duplicate Detection**:
  - Quickly scan and identify duplicate files (based on hash or filename/size).
  - Provides convenient cleanup options to free up redundant space.
- 📑 **File Type Statistics**:
  - Categorized statistics by file extension, giving you a clear view of which file types take up the most space.
- ⏱️ **Real-time Feedback**:
  - Scanning progress is pushed to the frontend in real-time, with top summary data (total size, file count) updating dynamically.
  - For large directories, a "Calculating..." status hint is provided without blocking user operations.
- 🛡️ **Stable & Robust**:
  - Built-in Panic capture and self-healing mechanism ensure scanning continues even when encountering special permissions or corrupted files.
  - Path normalization handles various file system path differences.
- 🖱️ **Convenient Interaction**:
  - Supports **Drag and Drop** folders for quick analysis.
  - Context menu supports "Open in File Explorer".
  - Responsive layout with window auto-adaptation.
  - **Internationalization**: Built-in English and Chinese support to meet different user needs.

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Framer Motion
- **Backend**: Rust, Tauri v2
- **Core Libraries**: 
  - `walkdir`: Efficient file system traversal
  - `sysinfo`: System information retrieval
  - `sha2`: File hash calculation
  - `regex`: Regular expression matching
- **Charts**: Recharts, D3.js, ECharts
- **Icons**: Lucide React

## ☕ Sponsor Project

If you find this project helpful, or if you like my work, please consider buying me a coffee! Your support is my motivation to continue maintaining and improving the project.

### Alipay

<img src="public/sponsor-qr.png" alt="Alipay QR Code" width="200" />

### Buy Me a Coffee

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/johnhelf)

## 🚀 Quick Start

### Prerequisites

- Install [Node.js](https://nodejs.org/)
- Install [Rust Environment](https://www.rust-lang.org/tools/install)
- Install [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

### Steps

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

4. Build for production:
   ```bash
   npm run tauri build
   ```

   Build for 32-bit (x86) Windows:
   ```bash
   npx tauri build --target i686-pc-windows-msvc
   ```

## 📝 License

MIT License
