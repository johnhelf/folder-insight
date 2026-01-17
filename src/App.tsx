import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { 
  FolderOpen, 
  ChevronRight, 
  ChevronDown, 
  File, 
  Folder, 
  BarChart3, 
  TreeDeciduous,
  Loader2,
  HardDrive,
  Files
} from "lucide-react";
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
} from "recharts";
import { formatSize, cn } from "./utils";
import {
  createTranslator,
  detectSystemLocale,
  getInitialLanguageMode,
  getLocaleNativeName,
  persistLanguageMode,
  resolveLocale,
  type LanguageMode,
} from "./i18n";

interface FileNode {
  name: string;
  path: string;
  size: number | null;
  is_dir: boolean;
  file_count: number;
  children: FileNode[] | null;
}

interface SizeUpdate {
    path: string;
    size: number;
    file_count: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

/**
 * 应用主组件：展示目录树与统计信息，并监听后端实时大小更新。
 * Main app component: renders directory tree and statistics; listens to backend realtime size updates.
 */
function App() {
  const [data, setData] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'chart'>('tree');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getInitialLanguageMode());
  const [systemLocale, setSystemLocale] = useState(detectSystemLocale());
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);

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
        return { ...node, size: update.size, file_count: update.file_count };
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
    try {
      setLoading(true);
      setError(null);
      setContextMenu(null);
      setExpandedPaths(new Set());
      setLoadingPaths(new Set());

      const result = await invoke<FileNode>("analyze_directory", { path });
      setData(result);
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
    const unlistenPromise = listen<SizeUpdate>('folder-size-updated', (event) => {
      setData(prev => (prev ? applySizeUpdate(prev, event.payload) : null));
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
    if (root.path === path) return root;
    if (!root.children) return null;

    for (const child of root.children) {
      const found = findNodeByPath(child, path);
      if (found) return found;
    }
    return null;
  };

  /**
   * 替换指定路径节点的 children，并尽量避免无意义的全树拷贝。
   * Replace children at the target path while avoiding unnecessary full-tree cloning.
   */
  const replaceChildrenAtPath = (root: FileNode, path: string, children: FileNode[]): FileNode => {
    if (root.path === path) return { ...root, children };
    if (!root.children) return root;

    let changed = false;
    const newChildren = root.children.map(child => {
      const next = replaceChildrenAtPath(child, path, children);
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

          if (result.children) {
            setData(prev => {
              if (!prev) return null;
              return replaceChildrenAtPath(prev, path, result.children!);
            });
          }
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
   * 统计图数据：仅展示已计算完成的根级子项，并将小项聚合到“其他”。
   * Chart dataset: only includes computed root children; groups small items into "Other".
   */
  const chartData = useMemo(() => {
    if (!data?.children) return [];

    const MAX_SLICES = 20;
    const OTHER_RATIO = 0.01;

    const childrenWithSize = data.children.filter(child => child.size !== null);
    const totalSize = childrenWithSize.reduce((acc, child) => acc + (child.size || 0), 0);
    if (totalSize === 0) return [];

    const threshold = totalSize * OTHER_RATIO;
    const sortedChildren = [...childrenWithSize].sort((a, b) => (b.size || 0) - (a.size || 0));

    const items: { name: string; value: number; formattedSize: string }[] = [];
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
      });
    }

    if (otherSize > 0 || otherCount > 0) {
      items.push({
        name: t('otherItems', { count: otherCount.toLocaleString(numberLocale) }),
        value: otherSize,
        formattedSize: formatSize(otherSize),
      });
    }

    return items;
  }, [data, numberLocale, t]);

  /**
   * 递归渲染目录树。
   * Recursively render directory tree.
   * @param node 当前节点 / Current node
   * @param depth 递归深度（用于缩进） / Depth (for indentation)
   */
  const renderTree = (node: FileNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path as string);
    const isLoading = loadingPaths.has(node.path as string);

    return (
      <div key={node.path as string} className="select-none">
        <div 
          className={cn(
            "flex items-center py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer transition-colors group",
            depth === 0 && "font-bold text-lg"
          )}
          style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
          onClick={() => node.is_dir && !isLoading && toggleExpand(node.path as string)}
          onContextMenu={(e) => handleContextMenu(e, node.path as string)}
        >
          <span className="mr-1 text-gray-500">
            {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
            ) : node.is_dir ? (
              isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
            ) : (
              <span className="w-4" />
            )}
          </span>
          <span className="mr-2">
            {node.is_dir ? (
              <Folder size={18} className="text-blue-500 fill-blue-500/20" />
            ) : (
              <File size={18} className="text-gray-400" />
            )}
          </span>
          <span className="flex-1 truncate mr-4">{node.name}</span>
          <div className="flex items-center gap-4 text-xs text-gray-400 font-mono group-hover:text-gray-600 dark:group-hover:text-gray-300">
            <span className="w-20 text-right truncate">
              {node.is_dir ? t('itemsCount', { count: node.file_count.toLocaleString(numberLocale) }) : '-'}
            </span>
            <span className="w-24 text-right truncate">
              {node.size === null ? t('calculating') : formatSize(node.size)}
            </span>
          </div>
        </div>
        {node.is_dir && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
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
            <div className="bg-blue-600 p-2 rounded-lg">
              <FolderOpen className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">{t('appTitle')}</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {data && (
              <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                <button 
                  onClick={() => setView('tree')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'tree' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <TreeDeciduous size={16} />
                  {t('treeView')}
                </button>
                <button 
                  onClick={() => setView('chart')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'chart' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <BarChart3 size={16} />
                  {t('chartView')}
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
                {currentLanguageLabel}
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
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <FolderOpen size={18} />}
              {t('selectFolder')}
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

            <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col">
              {view === 'tree' ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-800 text-xs font-medium text-gray-500 bg-gray-50/50 dark:bg-gray-800/50 select-none shrink-0">
                    <span className="flex-1 ml-8">{t('name')}</span>
                    <div className="flex items-center gap-4">
                      <span className="w-20 text-right">{t('fileCount')}</span>
                      <span className="w-24 text-right">{t('size')}</span>
                    </div>
                  </div>
                  <div ref={fileListRef} className="flex-1 overflow-auto p-2">
                    {renderTree(data)}
                  </div>
                </div>
              ) : (
                <div className="p-8 h-full flex flex-col items-center">
                  <h3 className="text-lg font-semibold mb-6 shrink-0">{t('topTitle')}</h3>
                  <div className="w-full flex-1 flex flex-col md:flex-row items-center justify-around overflow-hidden">
                    <div className="w-full md:w-1/2 h-full min-h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={120}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {chartData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            formatter={(value: any) => formatSize(Number(value || 0))}
                            contentStyle={{ 
                              backgroundColor: 'rgba(255, 255, 255, 0.96)',
                              borderRadius: '8px',
                              border: 'none',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="w-full md:w-1/2 flex flex-col gap-2 overflow-auto max-h-full p-4">
                      {chartData.map((item, index) => (
                        <div key={item.name as string} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                          <span className="flex-1 truncate text-sm">{item.name}</span>
                          <span className="text-sm font-mono text-gray-500">{item.formattedSize}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
