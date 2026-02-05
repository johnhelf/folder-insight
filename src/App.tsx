import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { 
  FolderOpen, 
  Folder, 
  BarChart3, 
  TreeDeciduous, 
  Loader2, 
  HardDrive, 
  Files, 
  Heart 
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { formatSize, cn, isTauri } from "./utils";
import {
  createTranslator,
  detectSystemLocale,
  getInitialLanguageMode,
  getLocaleNativeName,
  persistLanguageMode,
  resolveLocale,
  type LanguageMode,
} from "./i18n";
import { FileNode, SizeUpdate } from "./types";
import { SponsorModal } from "./components/SponsorModal";
import { TreeView } from "./components/TreeView";
import { ChartView } from "./components/ChartView";
import { TreemapView } from "./components/TreemapView";

/**
 * 应用主组件：展示目录树与统计信息，并监听后端实时大小更新。
 * Main app component: renders directory tree and statistics; listens to backend realtime size updates.
 */
function App() {
  const [data, setData] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'chart' | 'treemap'>('tree');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [currentViewPath, setCurrentViewPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'pie' | 'bar'>('pie');
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getInitialLanguageMode());
  const [systemLocale, setSystemLocale] = useState(detectSystemLocale());
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isSponsorModalOpen, setIsSponsorModalOpen] = useState(false);
  const pendingUpdates = useRef<Map<string, SizeUpdate>>(new Map());

  // 赞助弹窗自动弹出逻辑 / Auto-show sponsor modal logic
  useEffect(() => {
    const SPONSOR_KEY = 'last_sponsor_show_time';
    const FIRST_RUN_KEY = 'has_run_before';
    const SHOW_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 每7天弹出一次 / Show every 7 days

    const now = Date.now();
    const hasRunBefore = localStorage.getItem(FIRST_RUN_KEY);
    const lastShowTime = localStorage.getItem(SPONSOR_KEY);

    if (!hasRunBefore) {
      // 首次安装运行：记录状态，但不弹出
      // First run: mark as run but don't show
      localStorage.setItem(FIRST_RUN_KEY, 'true');
      localStorage.setItem(SPONSOR_KEY, now.toString());
    } else {
      // 非首次运行：检查间隔时间
      // Not first run: check interval
      const lastTime = lastShowTime ? parseInt(lastShowTime, 10) : 0;
      if (now - lastTime > SHOW_INTERVAL) {
        setIsSponsorModalOpen(true);
        localStorage.setItem(SPONSOR_KEY, now.toString());
      }
    }
  }, []);

  const fileListRef = useRef<HTMLDivElement | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    path: string;
  } | null>(null);

  const locale = useMemo(() => resolveLocale(languageMode, systemLocale), [languageMode, systemLocale]);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const numberLocale = locale === 'zh' ? 'zh-CN' : 'en-US';

  useEffect(() => {
    persistLanguageMode(languageMode);
  }, [languageMode]);

  useEffect(() => {
    const handler = () => setSystemLocale(detectSystemLocale());
    window.addEventListener('languagechange', handler as EventListener);
    return () => window.removeEventListener('languagechange', handler as EventListener);
  }, []);

  /**
   * 用于事件匹配的路径标准化：忽略大小写与分隔符差异。
   * Normalize path for event matching: ignore case and slash differences.
   */
  const normalizePathForMatch = (p: string) => p.replace(/\\/g, '/').toLowerCase();

  /**
   * 排序子节点：目录优先，其次大小降序（null 视为 -1，排在最后），最后按名称。
   * Sort children: folders first, then size desc (null as -1, last), then by name.
   */
  const sortChildren = (children: FileNode[]) => {
    children.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      const sizeA = a.size === null ? -1 : a.size;
      const sizeB = b.size === null ? -1 : b.size;
      if (sizeB !== sizeA) return sizeB - sizeA;

      return a.name.localeCompare(b.name);
    });
    return children;
  };

  /**
   * 将后端事件更新应用到目录树中，尽量保持未变化节点的引用稳定。
   * Apply backend update event to the tree while keeping unchanged node references stable.
   */
  const applySizeUpdate = (root: FileNode, update: SizeUpdate): FileNode => {
    const targetPath = normalizePathForMatch(update.path);

    const updateRecursively = (node: FileNode): FileNode => {
      if (normalizePathForMatch(node.path) === targetPath) {
        return {
          ...node,
          size: update.size,
          allocated_size: update.allocated_size,
          is_restricted: update.is_restricted,
          file_count: update.file_count,
        };
      }

      if (!node.children) return node;

      let changed = false;
      const newChildren = node.children.map(child => {
        const next = updateRecursively(child);
        if (next !== child) changed = true;
        return next;
      });

      if (!changed) return node;

      sortChildren(newChildren);
      return { ...node, children: newChildren };
    };

    return updateRecursively(root);
  };

  /**
   * 统一触发分析流程：清理状态并调用后端 analyze_directory。
   * Start analysis flow: reset UI state then invoke backend analyze_directory.
   */
  const analyzePath = useCallback(async (path: string) => {
    if (!isTauri()) {
      setError("Please run this app inside Tauri to use file scanning features.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setData(null); // 清空旧数据，避免事件匹配到错误的树
      setContextMenu(null);
      setExpandedPaths(new Set());
      setLoadingPaths(new Set());

      const result = await invoke<FileNode>("analyze_directory", { path });
      
      // 应用加载期间积累的所有更新
      // Apply all updates accumulated during loading
      let updatedResult = result;
      pendingUpdates.current.forEach((update) => {
        updatedResult = applySizeUpdate(updatedResult, update);
      });
      pendingUpdates.current.clear();

      setData(updatedResult);
      setCurrentViewPath(updatedResult.path);
      setExpandedPaths(new Set([result.path as string]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  const currentLanguageLabel =
    languageMode === 'auto'
      ? `${t('languageAuto')} (${getLocaleNativeName(systemLocale)})`
      : getLocaleNativeName(languageMode);

  const languageOptions = useMemo(
    () =>
      ([
        { mode: 'auto', label: `${t('languageAuto')} (${getLocaleNativeName(systemLocale)})` },
        { mode: 'zh', label: getLocaleNativeName('zh') },
        { mode: 'en', label: getLocaleNativeName('en') },
        { mode: 'ja', label: getLocaleNativeName('ja') },
        { mode: 'ko', label: getLocaleNativeName('ko') },
        { mode: 'es', label: getLocaleNativeName('es') },
        { mode: 'fr', label: getLocaleNativeName('fr') },
        { mode: 'de', label: getLocaleNativeName('de') },
      ] as const),
    [systemLocale, t],
  );

  /**
   * 限制右键菜单仅在文件列表（树状图）区域可用，其它位置禁用。
   * Allow context menu only inside file list (tree view); disable elsewhere.
   */
  const handleGlobalContextMenu = (e: React.MouseEvent) => {
    const target = e.target as Node | null;
    const isInsideFileList =
      view === 'tree' && !!target && !!fileListRef.current && fileListRef.current.contains(target);

    if (!isInsideFileList) {
      e.preventDefault();
      setContextMenu(null);
    }
  };

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setIsLanguageMenuOpen(false);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // 监听后台大小更新事件
  useEffect(() => {
    if (!isTauri()) return;

    const unlistenPromise = listen<SizeUpdate>('folder-size-updated', (event) => {
      const update = event.payload;
      const normalizedPath = normalizePathForMatch(update.path);
      
      setData(prev => {
        if (!prev) {
          // 如果数据还在加载中，先存入待处理队列
          // If data is loading, store in pending queue
          pendingUpdates.current.set(normalizedPath, update);
          return null;
        }
        return applySizeUpdate(prev, update);
      });
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  /**
   * 监听系统文件拖拽事件（Tauri）：拖拽文件夹到窗口后直接开始分析。
   * Listen to system file drag-drop events (Tauri): start analysis on folder drop.
   */
  useEffect(() => {
    if (!isTauri()) return;

    /**
     * 从不同版本/不同形态的拖拽事件 payload 中提取路径数组。
     * Extract dropped paths from drag-drop payloads across different event shapes/versions.
     */
    const extractDropPaths = (payload: unknown): string[] => {
      if (Array.isArray(payload)) {
        return payload.map(String).filter(Boolean);
      }
      if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        const paths = obj.paths;
        if (Array.isArray(paths)) {
          return paths.map(String).filter(Boolean);
        }
        const path = obj.path;
        if (typeof path === 'string' && path) {
          return [path];
        }
      }
      return [];
    };

    const setActive = () => setIsDragActive(true);
    const setInactive = () => setIsDragActive(false);

    const unlistenEnterPromise = listen('tauri://drag-enter', setActive);
    const unlistenOverPromise = listen('tauri://drag-over', setActive);
    const unlistenLeavePromise = listen('tauri://drag-leave', setInactive);
    const unlistenDropPromise = listen('tauri://drag-drop', async (event) => {
      setIsDragActive(false);
      const paths = extractDropPaths(event.payload);
      const [firstPath] = paths;
      if (firstPath) {
        await analyzePath(firstPath);
      }
    });

    const unlistenLegacyHoverPromise = listen('tauri://file-drop-hover', setActive);
    const unlistenLegacyCancelledPromise = listen('tauri://file-drop-cancelled', setInactive);
    const unlistenLegacyDropPromise = listen('tauri://file-drop', async (event) => {
      setIsDragActive(false);
      const paths = extractDropPaths(event.payload);
      const [firstPath] = paths;
      if (firstPath) {
        await analyzePath(firstPath);
      }
    });

    return () => {
      unlistenEnterPromise.then(unlisten => unlisten());
      unlistenOverPromise.then(unlisten => unlisten());
      unlistenLeavePromise.then(unlisten => unlisten());
      unlistenDropPromise.then(unlisten => unlisten());
      unlistenLegacyHoverPromise.then(unlisten => unlisten());
      unlistenLegacyCancelledPromise.then(unlisten => unlisten());
      unlistenLegacyDropPromise.then(unlisten => unlisten());
    };
  }, [analyzePath]);

  /**
   * 在树中按路径查找节点。
   * Find a node in the tree by its path.
   */
  const findNodeByPath = (root: FileNode, path: string): FileNode | null => {
    if (normalizePathForMatch(root.path) === normalizePathForMatch(path)) return root;
    if (!root.children) return null;

    for (const child of root.children) {
      const found = findNodeByPath(child, path);
      if (found) return found;
    }
    return null;
  };

  /**
   * 替换指定路径节点的 children、size 和 file_count，并尽量避免无意义的全树拷贝。
   * Replace children, size, and file_count at the target path while avoiding unnecessary full-tree cloning.
   */
  const updateNodeAtPath = (
    root: FileNode, 
    path: string, 
    update: Partial<FileNode>
  ): FileNode => {
    if (normalizePathForMatch(root.path) === normalizePathForMatch(path)) {
      return { ...root, ...update };
    }
    if (!root.children) return root;

    let changed = false;
    const newChildren = root.children.map(child => {
      const next = updateNodeAtPath(child, path, update);
      if (next !== child) changed = true;
      return next;
    });

    if (!changed) return root;
    return { ...root, children: newChildren };
  };

  /**
   * 计算顶部汇总的实时统计：
   * - 根节点 size 未回传时，使用已完成子项的累加值作为“当前进度”
   * Realtime summary for header:
   * - When root size is not ready, use accumulated completed children as progress.
   */
  const getRealtimeSummary = (node: FileNode) => {
    const children = node.children ?? [];
    const partialSize = children.reduce((acc, child) => acc + (child.size ?? 0), 0);
    const partialFileCount = children.reduce((acc, child) => acc + (child.file_count ?? 0), 0);
    const hasPending = children.some(child => child.is_dir && child.size === null);

    return { partialSize, partialFileCount, hasPending };
  };

  /**
   * 选择文件夹并调用后端分析入口。
   * Select a folder and invoke backend analysis entry.
   */
  const handleSelectFolder = async () => {
    if (!isTauri()) {
      setError("Please run this app inside Tauri to use file scanning features.");
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        await analyzePath(String(selected));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * 切换目录树节点的展开/折叠状态。
   * Toggle expand/collapse state of a tree node.
   * @param path 节点路径 / Node path
   */
  const toggleExpand = async (path: string) => {
    if (!isTauri()) return;
    const newExpanded = new Set(expandedPaths);

    if (newExpanded.has(path)) {
      newExpanded.delete(path);
      setExpandedPaths(newExpanded);
      return;
    }

    newExpanded.add(path);
    setExpandedPaths(newExpanded);

    if (data) {
      const node = findNodeByPath(data, path);
      if (node && node.is_dir && !node.children) {
        setLoadingPaths(prev => new Set(prev).add(path));
        try {
          const result = await invoke<FileNode>("analyze_directory", { path });

          setData(prev => {
            if (!prev) return null;
            
            // 应用此节点加载期间可能积累的更新
            // Apply updates that might have accumulated during this node's loading
            let updatedNode = result;
            pendingUpdates.current.forEach((update) => {
              updatedNode = applySizeUpdate(updatedNode, update);
            });
            // 注意：这里不清理 pendingUpdates，因为其他路径可能还需要它
            // Note: Don't clear all pendingUpdates here as other paths might still need them
            // 只移除当前路径相关的（如果有的话）
            pendingUpdates.current.delete(normalizePathForMatch(path));

            return updateNodeAtPath(prev, path, {
              children: updatedNode.children || [],
              size: updatedNode.size !== null ? updatedNode.size : findNodeByPath(prev, path)?.size || null,
              file_count: updatedNode.size !== null ? updatedNode.file_count : findNodeByPath(prev, path)?.file_count || 0
            });
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`Error loading ${path}: ${errMsg}`);
        } finally {
          setLoadingPaths(prev => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      }
    }
  };

  /**
   * 打开右键菜单。
   * Open context menu.
   */
  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      path,
    });
  };

  /**
   * 在系统文件资源管理器中打开当前右键选中的路径。
   * Open the context-selected path in system file explorer.
   */
  const handleOpenInExplorer = async () => {
    if (!isTauri()) return;
    if (contextMenu) {
      try {
        await invoke('open_in_explorer', { path: contextMenu.path });
      } catch (err) {
        console.error('Failed to open explorer:', err);
      }
      setContextMenu(null);
    }
  };

  /**
   * 统计图数据：仅展示当前视图路径下的计算完成子项，并将小项聚合到“其他”。
   * Chart dataset: only includes computed children of current view path; groups small items into "Other".
   */
  const chartData = useMemo(() => {
    if (!data) return [];

    // 根据 currentViewPath 找到对应节点
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode?.children) return [];

    const MAX_SLICES = 20;
    const OTHER_RATIO = 0.01;

    const childrenWithSize = targetNode.children.filter(child => child.size !== null);
    const totalSize = childrenWithSize.reduce((acc, child) => acc + (child.size || 0), 0);
    if (totalSize === 0) return [];

    const threshold = totalSize * OTHER_RATIO;
    const sortedChildren = [...childrenWithSize].sort((a, b) => (b.size || 0) - (a.size || 0));

    const items: { name: string; value: number; formattedSize: string; path: string; isDir: boolean }[] = [];
    let otherSize = 0;
    let otherCount = 0;

    for (const child of sortedChildren) {
      const size = child.size || 0;
      const shouldBeOther = size < threshold || items.length >= MAX_SLICES;

      if (shouldBeOther) {
        otherSize += size;
        otherCount += 1;
        continue;
      }

      items.push({
        name: child.name,
        value: size,
        formattedSize: formatSize(size),
        path: child.path,
        isDir: child.is_dir,
      });
    }

    if (otherSize > 0 || otherCount > 0) {
      items.push({
        name: t('otherItems', { count: otherCount.toLocaleString(numberLocale) }),
        value: otherSize,
        formattedSize: formatSize(otherSize),
        path: '',
        isDir: false,
      });
    }

    return items;
  }, [data, currentViewPath, numberLocale, t]);

  /**
   * 处理图表点击下钻
   * Handle chart click drill-down
   */
  const handleChartClick = async (item: any) => {
    if (!isTauri()) return;
    if (item && item.isDir && item.path) {
      // 检查是否需要加载子目录数据
      // Check if we need to load subdirectory data
      const node = findNodeByPath(data!, item.path);
      if (node && node.is_dir && !node.children) {
        setLoading(true);
        try {
          const result = await invoke<FileNode>("analyze_directory", { path: item.path });
          
          setData(prev => {
            if (!prev) return null;
            let updatedNode = result;
            pendingUpdates.current.forEach((update) => {
              updatedNode = applySizeUpdate(updatedNode, update);
            });
            pendingUpdates.current.delete(normalizePathForMatch(item.path));

            return updateNodeAtPath(prev, item.path, {
              children: updatedNode.children || [],
              size: updatedNode.size !== null ? updatedNode.size : findNodeByPath(prev, item.path)?.size || null,
              file_count: updatedNode.size !== null ? updatedNode.file_count : findNodeByPath(prev, item.path)?.file_count || 0
            });
          });
        } catch (err) {
          console.error(`Error loading ${item.path}:`, err);
        } finally {
          setLoading(false);
        }
      }
      setCurrentViewPath(item.path);
    }
  };

  /**
   * 返回上一级
   * Go back to parent directory
   */
  const handleGoUp = () => {
    if (!data || !currentViewPath || normalizePathForMatch(currentViewPath) === normalizePathForMatch(data.path)) return;

    // 简单实现：通过路径字符串操作找到上一级
    // Simple implementation: find parent by path string manipulation
    // 更好的方式可能是维护一个 stack 或者在 FileNode 中添加 parent 引用
    // Better way might be maintaining a stack or adding parent ref in FileNode
    
    // 尝试在树中查找父节点
    // Try to find parent node in tree
    const findParent = (root: FileNode, targetPath: string): FileNode | null => {
      if (!root.children) return null;
      for (const child of root.children) {
        if (normalizePathForMatch(child.path) === normalizePathForMatch(targetPath)) return root;
        const found = findParent(child, targetPath);
        if (found) return found;
      }
      return null;
    };

    const parent = findParent(data, currentViewPath);
    if (parent) {
      setCurrentViewPath(parent.path);
    }
  };

  return (
    <div
      className="h-screen flex flex-col bg-[#f8f9fa] dark:bg-[#0f1117] text-gray-900 dark:text-gray-100 font-sans overflow-hidden"
      onContextMenu={handleGlobalContextMenu}
    >
      {isDragActive && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center">
          <div className="px-6 py-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-white/90 dark:bg-gray-900/90 shadow-lg text-center">
            <div className="text-base font-semibold">{t('dragHintTitle')}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('dragHintSubtitle')}</div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 p-4 shrink-0">
        <div className="w-full px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <HardDrive size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
                Folder Insight
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                {t('subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 赞助作者按钮 / Sponsor button - Responsive Hide */}
            <button
              onClick={() => setIsSponsorModalOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/20 rounded-lg transition-colors border border-pink-200 dark:border-pink-800"
            >
              <Heart size={16} className="fill-pink-500" />
              <span>{t('sponsor')}</span>
            </button>

            <div className="hidden sm:block h-6 w-px bg-gray-200 dark:bg-gray-800 mx-1" />
            
            {data && (
              <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                <button 
                  onClick={() => setView('tree')}
                  title={t('treeView')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'tree' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <TreeDeciduous size={16} />
                  <span className="hidden lg:inline">{t('treeView')}</span>
                </button>
                <button 
                  onClick={() => setView('treemap')}
                  title={t('treemapView')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'treemap' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <BarChart3 size={16} />
                  <span className="hidden lg:inline">{t('treemapView')}</span>
                </button>
                <button 
                  onClick={() => {
                    setView('chart');
                    setViewMode('pie');
                  }}
                  title={t('chartView')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'chart' && viewMode === 'pie' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <BarChart3 size={16} />
                  <span className="hidden lg:inline">{t('chartView')}</span>
                </button>
                <button 
                  onClick={() => {
                    setView('chart');
                    setViewMode('bar');
                  }}
                  title={t('barChartView')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'chart' && viewMode === 'bar' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <BarChart3 size={16} className="rotate-90" />
                  <span className="hidden lg:inline">{t('barChartView')}</span>
                </button>
              </div>
            )}
            
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setIsLanguageMenuOpen(v => !v)}
                className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors"
                aria-haspopup="menu"
                aria-expanded={isLanguageMenuOpen}
              >
                <span className="hidden sm:inline">{currentLanguageLabel}</span>
                <span className="sm:hidden">{languageMode === 'auto' ? 'Auto' : languageMode.toUpperCase()}</span>
              </button>
              {isLanguageMenuOpen && (
                <div className="absolute right-0 mt-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px]">
                  <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 select-none">
                    {t('languageTitle')}
                  </div>
                  {languageOptions.map(opt => (
                    <button
                      key={opt.mode}
                      onClick={() => {
                        setLanguageMode(opt.mode);
                        setIsLanguageMenuOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700",
                        languageMode === opt.mode ? "bg-gray-100 dark:bg-gray-700" : "",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button 
              onClick={handleSelectFolder}
              disabled={loading}
              title={t('selectFolder')}
              className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 shrink-0"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <FolderOpen size={20} />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full p-4 overflow-hidden">
        {contextMenu && contextMenu.visible && (
          <div 
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleOpenInExplorer}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <FolderOpen size={14} />
              {t('openInExplorer')}
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 shrink-0">
            {error}
          </div>
        )}

        {!data && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="bg-gray-100 dark:bg-gray-800 p-8 rounded-full mb-4">
              <HardDrive size={64} className="opacity-20" />
            </div>
            <p className="text-lg">{t('emptyHint')}</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
            <p className="text-gray-500">{t('analyzing')}</p>
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col h-full space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="text-gray-500 text-sm mb-1 flex items-center gap-2">
                  <HardDrive size={14} /> {t('totalSize')}
                </div>
                <div className="text-2xl font-bold">
                  {(() => {
                    const { partialSize, hasPending } = getRealtimeSummary(data);
                    const isCalculating = hasPending;
                    if (data.size === null) {
                      return (
                        <>
                          {formatSize(partialSize)}
                          {isCalculating && <span className="text-base font-normal text-gray-500 ml-2">{t('calculatingInline')}</span>}
                        </>
                      );
                    }
                    return (
                      <>
                        {formatSize(data.size)}
                        {isCalculating && <span className="text-base font-normal text-gray-500 ml-2">{t('calculatingInline')}</span>}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="text-gray-500 text-sm mb-1 flex items-center gap-2">
                  <Files size={14} /> {t('totalFiles')}
                </div>
                <div className="text-2xl font-bold">
                  {(() => {
                    const { partialFileCount, hasPending } = getRealtimeSummary(data);
                    const isCalculating = hasPending;
                    const fileCountValue = data.size === null ? partialFileCount : data.file_count;
                    return (
                      <>
                        {fileCountValue.toLocaleString(numberLocale)}
                        {isCalculating && <span className="text-base font-normal text-gray-500 ml-2">{t('calculatingInline')}</span>}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="text-gray-500 text-sm mb-1 flex items-center gap-2">
                  <Folder size={14} /> {t('rootDirectory')}
                </div>
                <div className="text-lg font-semibold truncate" title={data.path as string}>
                  {data.name}
                </div>
              </div>
            </div>

            <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col relative">
              <AnimatePresence mode="wait">
                {view === 'tree' ? (
                  <motion.div
                    key="tree"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 flex flex-col overflow-hidden"
                  >
                    <TreeView 
                      data={data}
                      expandedPaths={expandedPaths}
                      loadingPaths={loadingPaths}
                      onToggleExpand={toggleExpand}
                      onContextMenu={handleContextMenu}
                      t={t}
                      numberLocale={numberLocale}
                    />
                  </motion.div>
                ) : view === 'treemap' ? (
                  <motion.div
                    key="treemap"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 overflow-hidden"
                  >
                    <TreemapView 
                      data={chartData}
                      t={t}
                      onDrillDown={handleChartClick}
                      onGoUp={handleGoUp}
                      canGoUp={!!currentViewPath && normalizePathForMatch(currentViewPath) !== normalizePathForMatch(data.path)}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="chart"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 overflow-hidden"
                  >
                    <ChartView 
                      chartData={chartData}
                      t={t}
                      onDrillDown={handleChartClick}
                      onGoUp={handleGoUp}
                      canGoUp={!!currentViewPath && normalizePathForMatch(currentViewPath) !== normalizePathForMatch(data.path)}
                      viewMode={viewMode}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* 赞助弹窗 / Sponsor Modal */}
      <SponsorModal 
        isOpen={isSponsorModalOpen} 
        onClose={() => setIsSponsorModalOpen(false)} 
        t={t}
      />
    </div>
  );
}

export default App;
