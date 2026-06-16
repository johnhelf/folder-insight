import { FileNode } from '../types';

export type FileCategory = 
  | 'video' 
  | 'image' 
  | 'audio' 
  | 'document' 
  | 'archive' 
  | 'software' 
  | 'system'
  | 'code'
  | 'database'
  | 'developer'
  | 'font'
  | 'book'
  | 'other';

export const CATEGORY_EXTENSIONS: Record<FileCategory, string[]> = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'vob', 'ogv', 'rm', 'rmvb', 'asf', 'amv', 'm2ts', 'm2v'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif', 'heic', 'heif', 'raw', 'ico', 'psd', 'ai', 'avif', 'xcf', 'indd', 'eps', 'cr2', 'nef', 'orf', 'sr2'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'mid', 'midi', 'ape', 'opus', 'alac', 'aiff', 'au', 'ra', 'mka'],
  document: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md', 'rtf', 'csv', 'epub', 'mobi', 'wps', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key', 'tex', 'log', 'mdx'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', 'xz', 'jar', 'apk', 'dmg', 'tgz', 'tbz2', 'z', 'cab', 'deb', 'rpm', 'sit', 'sitx', 'ace', 'lzh', 'arj'],
  software: ['exe', 'msi', 'bat', 'sh', 'app', 'cmd', 'vbs', 'com', 'bin', 'run', 'ps1', 'command'],
  system: ['dll', 'sys', 'ini', 'inf', 'dat', 'tmp', 'reg', 'swf', 'drv', 'cpl', 'msc', 'bak', 'chk', 'dmp', 'icns', 'cur', 'lnk', 'cfg', 'conf', 'lock', 'pid'],
  code: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'html', 'css', 'scss', 'less', 'json', 'json5', 'xml', 'yaml', 'yml', 'lua', 'pl', 'pm', 'r', 'm', 'v', 'vhdl', 'asm', 's', 'gradle', 'properties', 'vue', 'svelte', 'dart', 'toml', 'gitignore', 'dockerfile'],
  database: ['sql', 'db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'dbf', 'rdb', 'ndf', 'mdf', 'ibd', 'frm', 'myd', 'myi', 'db3', 'sdb'],
  developer: ['pdb', 'obj', 'o', 'lib', 'a', 'dylib', 'so', 'exp', 'def', 'res', 'rc', 'map', 'sln', 'vcproj', 'vcxproj', 'class', 'ipch', 'pch'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot', 'fon', 'ttc', 'pfb', 'pfm'],
  book: ['epub', 'mobi', 'azw', 'azw3', 'cbz', 'cbr', 'ibooks'],
  other: [] // Fallback
};

// Reverse map for faster lookup
const EXTENSION_MAP = new Map<string, FileCategory>();
Object.entries(CATEGORY_EXTENSIONS).forEach(([cat, exts]) => {
  exts.forEach(ext => EXTENSION_MAP.set(ext, cat as FileCategory));
});

/**
 * 根据文件名后缀获取文件分类
 * Get file category based on filename extension
 */
export function getFileCategory(filename: string): FileCategory {
  const lowerName = filename.toLowerCase();
  
  // Special handling for .so files (often .so.1.0.0)
  if (lowerName.includes('.so.') || lowerName.endsWith('.so')) {
      return 'developer';
  }

  const parts = lowerName.split('.');
  if (parts.length < 2) return 'other';
  const ext = parts.pop() || '';
  
  if (EXTENSION_MAP.has(ext)) {
    return EXTENSION_MAP.get(ext)!;
  }
  return 'other';
}

export interface FileItem {
  name: string;
  path: string;
  size: number;
  last_modified?: number;
}

export interface CategoryStat {
  category: FileCategory;
  size: number;
  count: number;
  files: FileItem[];
}

/**
 * 递归遍历文件树，聚合各分类的统计数据
 * Recursively traverse file tree and aggregate statistics for each category
 */
export function aggregateCategoryStats(node: FileNode): Record<FileCategory, CategoryStat> {
  const stats: Record<FileCategory, CategoryStat> = {
    video: { category: 'video', size: 0, count: 0, files: [] },
    image: { category: 'image', size: 0, count: 0, files: [] },
    audio: { category: 'audio', size: 0, count: 0, files: [] },
    document: { category: 'document', size: 0, count: 0, files: [] },
    archive: { category: 'archive', size: 0, count: 0, files: [] },
    software: { category: 'software', size: 0, count: 0, files: [] },
    system: { category: 'system', size: 0, count: 0, files: [] },
    code: { category: 'code', size: 0, count: 0, files: [] },
    database: { category: 'database', size: 0, count: 0, files: [] },
    developer: { category: 'developer', size: 0, count: 0, files: [] },
    font: { category: 'font', size: 0, count: 0, files: [] },
    book: { category: 'book', size: 0, count: 0, files: [] },
    other: { category: 'other', size: 0, count: 0, files: [] },
  };

  function traverse(n: FileNode) {
    if (!n.is_dir) {
      const cat = getFileCategory(n.name);
      const size = n.size || 0;
      stats[cat].size += size;
      stats[cat].count += 1;
      // 仅存储必要信息以节省内存
      stats[cat].files.push({ 
        name: n.name, 
        path: n.path, 
        size,
        last_modified: n.modified || undefined
      });
    } else if (n.children) {
      n.children.forEach(traverse);
    }
  }

  traverse(node);
  
  // Sort files by size desc
  Object.values(stats).forEach(stat => {
    stat.files.sort((a, b) => b.size - a.size);
  });

  return stats;
}

export type TimeRange = '24h' | '7d' | '30d' | '1y' | 'older';

export interface TemporalStat {
  range: TimeRange;
  labelKey: string;
  size: number;
  count: number;
  files: FileItem[];
}

/**
 * 递归遍历文件树，按修改时间聚合统计数据
 * Recursively traverse file tree and aggregate statistics by modification time
 */
export function aggregateTemporalStats(node: FileNode): Record<TimeRange, TemporalStat> {
  const stats: Record<TimeRange, TemporalStat> = {
    '24h': { range: '24h', labelKey: 'time24h', size: 0, count: 0, files: [] },
    '7d': { range: '7d', labelKey: 'time7d', size: 0, count: 0, files: [] },
    '30d': { range: '30d', labelKey: 'time30d', size: 0, count: 0, files: [] },
    '1y': { range: '1y', labelKey: 'time1y', size: 0, count: 0, files: [] },
    'older': { range: 'older', labelKey: 'timeOlder', size: 0, count: 0, files: [] },
  };

  const now = Date.now() / 1000; // Current time in seconds
  const day = 24 * 3600;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  function traverse(n: FileNode) {
    if (!n.is_dir) {
      const size = n.size || 0;
      const modified = n.modified || 0;
      const age = now - modified;

      let range: TimeRange = 'older';
      if (age < day) range = '24h';
      else if (age < week) range = '7d';
      else if (age < month) range = '30d';
      else if (age < year) range = '1y';

      stats[range].size += size;
      stats[range].count += 1;
      stats[range].files.push({ 
        name: n.name, 
        path: n.path, 
        size,
        last_modified: modified || undefined
      });
    } else if (n.children) {
      n.children.forEach(traverse);
    }
  }

  traverse(node);
  
  // Sort files by size desc
  Object.values(stats).forEach(stat => {
    stat.files.sort((a, b) => b.size - a.size);
  });

  return stats;
}
