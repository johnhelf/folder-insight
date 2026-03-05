import { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from "react";
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
  Heart,
  RefreshCw,
  PieChart
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { formatSize, cn, isTauri, isMacOS, isWindows } from "./utils";
import { version } from "../package.json";
import {
  createTranslator,
  detectSystemLocale,
  getInitialLanguageMode,
  getLocaleNativeName,
  persistLanguageMode,
  resolveLocale,
  isRTLLocale,
  type LanguageMode,
} from "./i18n";
import { processForSunburst, processForTreemap } from './chartHelpers';
import { FileNode, SizeUpdate, StructureUpdate, BatchStructureUpdate, BatchSizeUpdate, DiskStats } from "./types";
import { SponsorModal } from "./components/SponsorModal";
import { RateModal } from "./components/RateModal";
import { TreeView } from "./components/TreeView";
// import { ChartView } from "./components/ChartView";
// import { TreemapView } from "./components/TreemapView";

const ChartView = lazy(() => import("./components/ChartView").then(module => ({ default: module.ChartView })));
const TreemapView = lazy(() => import("./components/TreemapView").then(module => ({ default: module.TreemapView })));
const FileTypeView = lazy(() => import("./components/FileTypeView").then(module => ({ default: module.FileTypeView })));

interface ProgressUpdate {
  scanned_count: number;
  current_path: string;
}

/**
 * 应用主组件：展示目录树与统计信息，并监听后端实时大小更新。
 * Main app component: renders directory tree and statistics; listens to backend realtime size updates.
 */
function App() {
  const [data, setData] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [diskStats, setDiskStats] = useState<DiskStats | null>(null);
  const [scanProgress, setScanProgress] = useState<ProgressUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'chart' | 'treemap' | 'fileType'>('tree');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [currentViewPath, setCurrentViewPath] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getInitialLanguageMode());
  const [systemLocale, setSystemLocale] = useState(detectSystemLocale());
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isSponsorModalOpen, setIsSponsorModalOpen] = useState(false);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [sizeMetric, setSizeMetric] = useState<'logical' | 'allocated'>('logical');
  const [isReceivingUpdates, setIsReceivingUpdates] = useState(false);
  // const [isRealtimePaused, setIsRealtimePaused] = useState(false); // 移除暂停功能 / Remove pause feature
  const pendingUpdates = useRef<Map<string, SizeUpdate>>(new Map());
  const pendingStructureUpdates = useRef<Map<string, StructureUpdate>>(new Map());
  const updateTimeoutRef = useRef<number | null>(null);
  const isUpdateScheduled = useRef(false);
  // const pausedUpdates = useRef<Map<string, SizeUpdate>>(new Map());
  const needsSort = useRef(false);
  const isRefreshing = useRef(false); // Flag to pause updates during refresh
  const hasCheckedModalRef = useRef(false); // 防止双重弹窗 / Prevent double modal show

  // 定时排序逻辑：每5秒检查是否需要排序
  // Interval sorting logic: check every 5s if sorting is needed
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (needsSort.current) {
        console.log('Sorting tree...');
        setData(prev => {
          if (!prev) return null;
          return sortTreeRecursive(prev);
        });
        needsSort.current = false;
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  // 监听扫描进度
  // Listen for scan progress
  useEffect(() => {
    if (!isTauri()) return;
    const unlistenPromise = listen<ProgressUpdate>('scan-progress', (event) => {
        setScanProgress(event.payload);
    });
    return () => {
        unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // 弹窗自动弹出逻辑 (赞助 & 评分) / Auto-show modal logic (Sponsor & Rate)
  useEffect(() => {
    if (!isTauri()) return;
    if (hasCheckedModalRef.current) return;
    hasCheckedModalRef.current = true;

    const now = Date.now();
    const FIRST_RUN_TIME_KEY = 'first_run_time';
    const HAS_SHOWN_SPONSOR_KEY = 'has_shown_sponsor_modal';
    const HAS_SHOWN_RATE_KEY = 'has_shown_rate_modal';
    const LAST_MODAL_SHOW_TIME_KEY = 'last_modal_show_time';
    
    // 首次运行时间 / First run time
    let firstRunTime = parseInt(localStorage.getItem(FIRST_RUN_TIME_KEY) || '0', 10);
    if (firstRunTime === 0) {
      firstRunTime = now;
      localStorage.setItem(FIRST_RUN_TIME_KEY, now.toString());
    }

    // 检查是否满足3天等待期 / Check 3-day delay
    // 3 days = 3 * 24 * 60 * 60 * 1000 ms
    if (now - firstRunTime < 3 * 24 * 60 * 60 * 1000) {
      return;
    }

    let hasShownSponsor = localStorage.getItem(HAS_SHOWN_SPONSOR_KEY) === 'true';
    let hasShownRate = localStorage.getItem(HAS_SHOWN_RATE_KEY) === 'true';

    // 如果两个都显示过了，重置状态以开启新一轮交替循环
    // If both shown, reset state to start a new alternating cycle
    if (hasShownSponsor && hasShownRate) {
      hasShownSponsor = false;
      hasShownRate = false;
      localStorage.setItem(HAS_SHOWN_SPONSOR_KEY, 'false');
      localStorage.setItem(HAS_SHOWN_RATE_KEY, 'false');
    }

    // 互斥检查 / Mutex check
    if (isSponsorModalOpen || isRateModalOpen) {
      return;
    }

    // 决定显示哪一个 / Decide which to show
    // 逻辑：交替显示。先赞助，后评分。
    // Logic: Alternate. Sponsor first, then Rate.
    
    if (!hasShownSponsor) {
      setIsSponsorModalOpen(true);
      localStorage.setItem(HAS_SHOWN_SPONSOR_KEY, 'true');
      localStorage.setItem(LAST_MODAL_SHOW_TIME_KEY, now.toString());
    } else if (!hasShownRate) {
      // 评分弹窗仅限Windows / Rate modal Windows only
      if (isWindows()) {
        setIsRateModalOpen(true);
        localStorage.setItem(HAS_SHOWN_RATE_KEY, 'true');
        localStorage.setItem(LAST_MODAL_SHOW_TIME_KEY, now.toString());
      } else {
        // 非Windows系统，标记为已显示，以便下次还尝试显示
        // Non-Windows, mark as shown to avoid retry
        localStorage.setItem(HAS_SHOWN_RATE_KEY, 'true');
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
  const isRTL = useMemo(() => isRTLLocale(locale), [locale]);
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
   * 用于事件匹配的路径标准化：忽略大小写与分隔符差异，去除末尾斜杠。
   * Normalize path for event matching: ignore case and slash differences, remove trailing slash.
   */
  const normalizePathForMatch = (p: string) => {
    if (!p) return "";
    let normalized = p.replace(/\\/g, '/').toLowerCase();
    // 去除末尾斜杠（除非是根路径如 "c:/" 或 "/"）
    // Remove trailing slash (unless it is root "c:/" or "/")
    if (normalized.length > 1 && normalized.endsWith('/')) {
        // 特殊情况：windows 盘符 "c:/" -> "c:"，或者保留 "c:/"？
        // 如果 Rust 端的 normalize_path_string 对于 "C:\" 返回 "C:\"，那么这里变成 "c:/"
        // 如果 Rust 端对于 "C:" 返回 "C:"，那么这里变成 "c:"
        // 为了统一，我们去掉末尾斜杠。
        // For consistency, remove trailing slash.
        normalized = normalized.slice(0, -1);
    }
    return normalized;
  };

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
   * 递归排序整个树
   * Recursively sort the entire tree
   */
  const sortTreeRecursive = (node: FileNode): FileNode => {
    if (!node.children) return node;
    const newChildren = node.children.map(sortTreeRecursive);
    sortChildren(newChildren);
    return { ...node, children: newChildren };
  };

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

  const getNodeMetricSize = (node: FileNode) => {
    return sizeMetric === 'allocated' ? node.allocated_size : node.size;
  };

  const getRealtimeSummary = (node: FileNode) => {
    const children = node.children ?? [];
    const partialSize = children.reduce((acc, child) => acc + (getNodeMetricSize(child) ?? 0), 0);
    const partialFileCount = children.reduce((acc, child) => acc + (child.file_count ?? 0), 0);
    const hasPending = children.some(
      child => child.is_dir && getNodeMetricSize(child) === null
    );

    return { partialSize, partialFileCount, hasPending };
  };

  /**
   * 批量应用更新（结构和大小），通过单次遍历树实现 O(N) 复杂度。
   * Batch apply updates (structure and size) with single tree traversal O(N).
   * 优化：只遍历受影响的路径 / Optimization: Only traverse affected paths
   * 
   * NEW: Supports auto-vivification of missing child nodes based on structure updates.
   */
  const applyBatchUpdates = (
    node: FileNode,
    structureUpdates: Map<string, StructureUpdate>,
    sizeUpdates: Map<string, SizeUpdate>,
    affectedPaths: Set<string>,
    _isRoot: boolean = false,
    appliedPaths: Set<string>,
    // Optional index for faster lookups of children updates
    updatesByParent?: Map<string, string[]> 
  ): FileNode => {
    const normalizedPath = normalizePathForMatch(node.path);
    
    // Debugging: Log path matching for root or first level children to verify normalization
    if (_isRoot && structureUpdates.size > 0) {
        // console.log(`[applyBatchUpdates] Root path: ${normalizedPath}. Pending structure updates: ${structureUpdates.size}`);
    }

    // Optimization: Skip if path is not affected (and we are not forcing full update with empty set)
    // BUT: If we have pending child updates for this node (even if node itself is not marked affected), we must process it!
    // The "affectedPaths" set might not contain the parent if only the child was updated.
    // So we need to check updatesByParent too.
    let hasPendingChildUpdates = false;
    if (updatesByParent && updatesByParent.has(normalizedPath)) {
        hasPendingChildUpdates = true;
    }

    if (affectedPaths.size > 0 && !affectedPaths.has(normalizedPath) && !hasPendingChildUpdates) {
        return node;
    }

    let newNode = node;
    
    // 1. 应用结构更新 / Apply structure update
    if (structureUpdates.has(normalizedPath)) {
      appliedPaths.add(normalizedPath); // Mark as applied
      const update = structureUpdates.get(normalizedPath)!;
      // Ensure children are not null if update provides empty array
      const newChildren = update.children || [];

      // We need to merge newChildren with existing children to preserve calculated sizes/counts of sub-directories
      // otherwise a structure update resets everything to 0/null until next size update arrives.
      const prevChildrenMap = new Map((newNode.children || []).map(c => [normalizePathForMatch(c.path), c]));

      const mergedChildren = newChildren.map(newChild => {
        const prevChild = prevChildrenMap.get(normalizePathForMatch(newChild.path));
        if (prevChild) {
          // 如果新节点有子节点（通常是浅层的），我们需要递归合并旧节点的子节点（深层的）
          // If newChild has children (usually shallow), we need to recursively merge old children (deep)
          let finalChildren = newChild.children;
          
          if (newChild.children && newChild.children.length > 0) {
             // 新节点有子节点列表，我们需要保留其中匹配到的旧子节点的深层结构
             // New node has children list, we must preserve deep structure of matched old children
             const oldGrandChildrenMap = new Map((prevChild.children || []).map(c => [normalizePathForMatch(c.path), c]));
             
             finalChildren = newChild.children.map(grandChild => {
                 const oldGrandChild = oldGrandChildrenMap.get(normalizePathForMatch(grandChild.path));
                 if (oldGrandChild) {
                     // 递归保留孙节点的子节点和统计数据
                     // Recursively preserve grandchildren's children and stats
                     return {
                         ...grandChild,
                         children: (grandChild.children && grandChild.children.length > 0) ? grandChild.children : oldGrandChild.children,
                         // Heuristic: if new size is 0 and old size > 0, keep old size
                         size: (grandChild.size === 0 && (oldGrandChild.size || 0) > 0) ? oldGrandChild.size : (grandChild.size ?? oldGrandChild.size),
                         allocated_size: grandChild.allocated_size ?? oldGrandChild.allocated_size,
                         file_count: (grandChild.is_dir && !grandChild.file_count) ? oldGrandChild.file_count : grandChild.file_count,
                         is_restricted: grandChild.is_restricted || oldGrandChild.is_restricted,
                         modified: grandChild.modified ?? oldGrandChild.modified,
                     };
                 }
                 return grandChild;
             });
          } else {
             // 新节点没有子节点（或为空），直接保留旧子节点
             // New node has no children, keep old children
             finalChildren = prevChild.children;
          }

          return {
            ...newChild,
            children: finalChildren,
            // Preserve calculated stats if newChild doesn't have them
            // Heuristic: if new size is 0 and old size > 0, keep old size
            size: (newChild.size === 0 && (prevChild.size || 0) > 0) ? prevChild.size : (newChild.size ?? prevChild.size),
            allocated_size: newChild.allocated_size ?? prevChild.allocated_size,
            file_count: (newChild.is_dir && !newChild.file_count) ? prevChild.file_count : newChild.file_count,
            is_restricted: prevChild.is_restricted || newChild.is_restricted,
            modified: newChild.modified ?? prevChild.modified,
          };
        }
        return newChild;
      });

      newNode = { ...newNode, children: mergedChildren };
    }

    // 1.5. Auto-vivify missing children based on updatesByParent
    // This handles the case where a child update arrives BEFORE the parent update, or parent update is missing.
    if (updatesByParent && updatesByParent.has(normalizedPath)) {
        const childPaths = updatesByParent.get(normalizedPath)!;
        const currentChildrenMap = new Map((newNode.children || []).map(c => [normalizePathForMatch(c.path), c]));
        let childrenModified = false;
        
        const newChildrenList = [...(newNode.children || [])];

        for (const childPath of childPaths) {
            if (!currentChildrenMap.has(childPath)) {
                // This child is missing! Create a placeholder.
                // We need the name. Extract from path.
                // normalizedPath uses '/'
                const lastSlash = childPath.lastIndexOf('/');
                const name = lastSlash !== -1 ? childPath.substring(lastSlash + 1) : childPath;
                
                // Try to find the original raw path from the update to be correct with separators if possible
                // But structureUpdates keys are normalized. We can check the update object itself if it exists.
                const update = structureUpdates.get(childPath);
                const rawPath = update ? update.path : childPath; // Fallback
                const rawName = update ? (update.path.split(/[/\\]/).pop() || name) : name;

                const placeholderChild: FileNode = {
                    name: rawName,
                    path: rawPath,
                    is_dir: true, // It has structure update, so it must be a dir
                    children: [],
                    size: 0,
                    file_count: 0,
                    is_restricted: false,
                    modified: null,
                    allocated_size: null
                };

                newChildrenList.push(placeholderChild);
                currentChildrenMap.set(childPath, placeholderChild); // Update map for subsequent checks
                childrenModified = true;
                
                // console.log(`[applyBatchUpdates] Auto-vivified missing child: ${rawPath} under ${newNode.path}`);
            }
        }

        if (childrenModified) {
            newNode = { ...newNode, children: newChildrenList };
        }
    }

    // 2. 应用大小更新 / Apply size update
    if (sizeUpdates.has(normalizedPath)) {
      appliedPaths.add(normalizedPath); // Mark as applied
      const update = sizeUpdates.get(normalizedPath)!;
      newNode = {
        ...newNode,
        // Heuristic: if new size is 0 and old size > 0, keep old size to prevent flashing
        size: (update.size === 0 && (newNode.size || 0) > 0) ? newNode.size : update.size,
        allocated_size: update.allocated_size,
        is_restricted: update.is_restricted,
        file_count: update.file_count,
      };
    }

    // 3. 递归处理子节点 / Recurse into children
    if (!newNode.children) return newNode;

    let childrenChanged = false;
    const newChildren = newNode.children.map(child => {
      // 移除剪枝优化，确保所有受影响的子节点都能更新
      // Remove pruning optimization to ensure all affected children are updated
      const newChild = applyBatchUpdates(child, structureUpdates, sizeUpdates, affectedPaths, false, appliedPaths, updatesByParent);
      if (newChild !== child) childrenChanged = true;
      return newChild;
    });

    if (childrenChanged || newNode !== node) {
      return { ...newNode, children: newChildren };
    }

    return node;
  };

  /**
   * Helper to index updates by their parent path for O(1) lookup
   * Enhanced: Recursively builds parent-child mapping up to the root to ensure
   * deep paths can be auto-vivified even if intermediate parents are missing in the update batch.
   */
  const buildUpdatesByParent = (structureUpdates: Map<string, StructureUpdate>): Map<string, string[]> => {
    const map = new Map<string, Set<string>>();
    
    for (const path of structureUpdates.keys()) {
        let currentPath = path;
        
        // Walk up the path and register all parent->child relationships
        // This ensures that if we have an update for A/B/C, we also ensure A knows about B, 
        // even if there is no explicit update for B.
        while (true) {
            const lastSlash = currentPath.lastIndexOf('/');
            if (lastSlash === -1) break;
            
            const parentPath = currentPath.substring(0, lastSlash);
            if (!parentPath) break; // Stop at root if empty (or handle "C:" case)
            
            if (!map.has(parentPath)) {
                map.set(parentPath, new Set());
            }
            map.get(parentPath)!.add(currentPath);
            
            // Move up one level
            currentPath = parentPath;
        }
    }
    
    // Convert Sets to Arrays
    const result = new Map<string, string[]>();
    for (const [k, v] of map) {
        result.set(k, Array.from(v));
    }
    return result;
  };

  /**
   * 生成所有受影响路径及其祖先路径的集合
   * Generate set of all affected paths and their ancestors
   */
  const getAffectedPaths = (updatesList: Map<string, any>[]): Set<string> => {
    const affected = new Set<string>();
    updatesList.forEach(map => {
      for (const rawPath of map.keys()) {
        // rawPath is already normalized because keys are normalized
        let current = rawPath;
        affected.add(current);
        
        while (true) {
          const lastSlash = current.lastIndexOf('/');
          if (lastSlash === -1) break;
          
          current = current.substring(0, lastSlash);
          
          if (current.length > 0) {
            affected.add(current);
          } else {
            break; 
          }
        }
      }
    });
    return affected;
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
      setScanProgress(null);
      setDiskStats(null);

      const [result, stats] = await Promise.all([
          invoke<FileNode>("analyze_directory", { path }),
          invoke<DiskStats | null>("get_disk_stats", { path }).catch(e => {
              console.error("Failed to get disk stats:", e);
              return null;
          })
      ]);
      setDiskStats(stats);
      
      // 应用加载期间积累的所有更新
      // Apply all updates accumulated during loading
      let updatedResult = result;
      
      const sUpdates = new Map(pendingStructureUpdates.current);
      const zUpdates = new Map(pendingUpdates.current);
      
      // 使用 applyBatchUpdates 批量处理，确保正确合并
      // Use applyBatchUpdates for batch processing to ensure correct merging
      if (sUpdates.size > 0 || zUpdates.size > 0) {
        // const affected = getAffectedPaths([sUpdates, zUpdates]);
        // 暂时禁用 affectedPaths 优化，传入空 Set 以强制全量更新
        // Temporarily disable affectedPaths optimization, pass empty Set to force full update
        const affected = new Set<string>(); 
        // console.log(`[analyzePath] Applying updates. Structure: ${sUpdates.size}, Size: ${zUpdates.size}`);
        const appliedPaths = new Set<string>();
        const updatesByParent = buildUpdatesByParent(sUpdates);
        updatedResult = applyBatchUpdates(updatedResult, sUpdates, zUpdates, affected, true, appliedPaths, updatesByParent);
        
        // Remove applied
        for (const path of appliedPaths) {
            pendingStructureUpdates.current.delete(path);
            pendingUpdates.current.delete(path);
        }
      } else {
        // console.log(`[analyzePath] No pending updates to apply.`);
      }
      
      // pendingStructureUpdates.current.clear();
      // pendingUpdates.current.clear();

      setData(sortTreeRecursive(updatedResult));
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
        { mode: 'zh_tw', label: getLocaleNativeName('zh_tw') },
        { mode: 'en', label: getLocaleNativeName('en') },
        { mode: 'ru', label: getLocaleNativeName('ru') },
        { mode: 'ar', label: getLocaleNativeName('ar') },
        { mode: 'ja', label: getLocaleNativeName('ja') },
        { mode: 'ko', label: getLocaleNativeName('ko') },
        { mode: 'es', label: getLocaleNativeName('es') },
        { mode: 'fr', label: getLocaleNativeName('fr') },
        { mode: 'de', label: getLocaleNativeName('de') },
        { mode: 'it', label: getLocaleNativeName('it') },
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


  // 调度更新：如果这是第一个待处理的更新（无论是结构还是大小），则设置定时器
  // Schedule update: if this is the first pending update (structure or size), set timeout
  const scheduleUpdate = useCallback(() => {
    if (isUpdateScheduled.current) return;
    isUpdateScheduled.current = true;

    // 每 500ms 更新一次，避免界面过于频繁跳动但保持响应感
    // Update every 500ms to avoid too much flickering but keep it responsive
    setTimeout(() => {
      isUpdateScheduled.current = false;
      
      setData((prev) => {
        // 如果还没有数据（例如正在初始加载），则不处理更新，保留在 pendingUpdates 中
        // If no data (e.g. initial loading), skip update processing, keep in pendingUpdates
        if (!prev) {
          return null;
        }

        // 如果正在刷新，暂停更新处理，让 pendingUpdates 积累
        // If refreshing, pause update processing, let pendingUpdates accumulate
        if (isRefreshing.current) {
          return prev;
        }

        // IMPORTANT: Read refs inside setData to ensure we handle current state
        // 创建更新 Map 的快照
        const sUpdates = new Map(pendingStructureUpdates.current);
        const zUpdates = new Map(pendingUpdates.current);
        
        if (sUpdates.size === 0 && zUpdates.size === 0) {
          return prev;
        }

        console.log(`Processing batch updates: ${sUpdates.size} structure, ${zUpdates.size} size`);
        
        const affected = getAffectedPaths([sUpdates, zUpdates]);
        // Temporarily disable affectedPaths optimization to ensure full data consistency
        // const affected = new Set<string>();
        const appliedPaths = new Set<string>();
        const updatesByParent = buildUpdatesByParent(sUpdates);
        const updatedTree = applyBatchUpdates(prev, sUpdates, zUpdates, affected, true, appliedPaths, updatesByParent);
        
        // Remove processed updates from refs (whether applied or not/orphaned)
        // This prevents the "Calculating..." loop for updates that cannot be applied (e.g. missing parent)
        // appliedPaths tracks successfully applied updates.
        // But for orphans, we must also clear them to avoid infinite retries.
        
        // Strategy: Clear ALL updates that were in the current batch.
        // If they were not applied, it means they are orphans or invalid for current tree state.
        // Keeping them causes infinite "Calculating..." state.
        
        for (const [path] of sUpdates) {
           pendingStructureUpdates.current.delete(path);
        }
        for (const [path] of zUpdates) {
           pendingUpdates.current.delete(path);
        }
        
        // Log remaining (unapplied) updates count
        if (pendingStructureUpdates.current.size > 0 || pendingUpdates.current.size > 0) {
            console.log(`[scheduleUpdate] Unapplied updates retained: ${pendingStructureUpdates.current.size} structure, ${pendingUpdates.current.size} size`);
        }

        console.log(`[scheduleUpdate] Processed batch. Applied ${appliedPaths.size} updates.`);
        
        // Remove retry loop to prevent infinite processing of orphans
        /*
        if (pendingStructureUpdates.current.size > 0) {
            console.log(`[scheduleUpdate] Retrying remaining ${pendingStructureUpdates.current.size} structure updates in 200ms...`);
            setTimeout(() => scheduleUpdate(), 200);
        }
        */
        
        // 只有在数据真正变化时才重新排序
        // Only resort if data changed
        return sortTreeRecursive(updatedTree); 
      });
    }, 500);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    const markUpdating = () => {
      setIsReceivingUpdates(true);
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = setTimeout(() => {
        setIsReceivingUpdates(false);
        updateTimeoutRef.current = null;
      }, 2000);
    };

    const unlistenSizeBatchPromise = listen<BatchSizeUpdate>('folder-size-batch-updated', (event) => {
      markUpdating();
      const { updates } = event.payload;
      updates.forEach(update => {
        pendingUpdates.current.set(normalizePathForMatch(update.path), update);
      });
      needsSort.current = true;
      scheduleUpdate();
    });

    // 监听旧版单条更新（兼容性保留）
    // Listen for legacy single update (kept for compatibility)
    const unlistenSizePromise = listen<SizeUpdate>('folder-size-updated', (event) => {
      markUpdating();
      const update = event.payload;
      // 使用标准化路径作为 Key，以便 applyBatchUpdates 中能正确匹配
      // Use normalized path as Key for correct matching in applyBatchUpdates
      pendingUpdates.current.set(normalizePathForMatch(update.path), update);
      needsSort.current = true;
      scheduleUpdate();
    });

    const unlistenStructureBatchPromise = listen<BatchStructureUpdate>('folder-structure-batch-updated', (event) => {
        markUpdating();
        const { updates } = event.payload;
        updates.forEach(update => {
            pendingStructureUpdates.current.set(normalizePathForMatch(update.path), update);
        });
        needsSort.current = true;
        scheduleUpdate();
    });

    // 监听旧版单条更新（兼容性保留）
    // Listen for legacy single update (kept for compatibility)
    const unlistenStructurePromise = listen<StructureUpdate>('folder-structure-updated', (event) => {
      markUpdating();
      const update = event.payload;
      // 使用标准化路径作为 Key
      // Use normalized path as Key
      pendingStructureUpdates.current.set(normalizePathForMatch(update.path), update);
      needsSort.current = true;
      scheduleUpdate();
    });

    return () => {
      unlistenSizeBatchPromise.then(unlisten => unlisten());
      unlistenSizePromise.then(unlisten => unlisten());
      unlistenStructureBatchPromise.then(unlisten => unlisten());
      unlistenStructurePromise.then(unlisten => unlisten());
    };
  }, []); // 移除 isRealtimePaused 依赖 / Remove dependency

  // 移除处理暂停更新的 effect
  // Remove effect for paused updates

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

  const handleRefresh = async () => {
    if (!isTauri() || !data) return;
    const targetPath = currentViewPath ?? data.path;
    
    // Optimization: Treat refresh as a fresh analysis to avoid expensive merge operations
    // caused by large update events on existing tree.
    // 优化：将刷新视为新的分析，以避免现有树上的大量更新事件导致的昂贵合并操作。
    analyzePath(targetPath);
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
            
            // 使用 applyBatchUpdates 替代已删除的 applySizeUpdate
            // Use applyBatchUpdates instead of deleted applySizeUpdate
            const sUpdates = new Map<string, StructureUpdate>();
            const zUpdates = new Map(pendingUpdates.current);
            // 只需要当前节点及其子节点的更新，但 applyBatchUpdates 会处理过滤
            // Just need updates for current node and children, applyBatchUpdates handles filtering
            
            if (zUpdates.size > 0) {
                 // const affected = getAffectedPaths([zUpdates]);
                 const appliedPaths = new Set<string>();
                 const updatesByParent = buildUpdatesByParent(sUpdates);
                 updatedNode = applyBatchUpdates(updatedNode, sUpdates, zUpdates, new Set(), true, appliedPaths, updatesByParent);
                 
                 // Clear applied from pendingUpdates
                 for (const path of appliedPaths) {
                    pendingUpdates.current.delete(path);
                 }
            }

            // 注意：这里不清理 pendingUpdates，因为其他路径可能还需要它
            // Note: Don't clear all pendingUpdates here as other paths might still need them
            // 只移除当前路径相关的（如果有的话）- 已经在上面处理了
            // pendingUpdates.current.delete(normalizePathForMatch(path));

            const newTree = updateNodeAtPath(prev, path, {
              children: updatedNode.children || [],
              size: updatedNode.size !== null ? updatedNode.size : findNodeByPath(prev, path)?.size || null,
              file_count: updatedNode.size !== null ? updatedNode.file_count : findNodeByPath(prev, path)?.file_count || 0
            });
            return sortTreeRecursive(newTree);
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
  const handleContextMenu = (e: React.MouseEvent | MouseEvent, path: string) => {
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
   * 统计图数据：生成 ECharts 需要的树形结构
   * Chart dataset: generate tree structure for ECharts
   */
  const sunburstData = useMemo(() => {
    if (!data) return null;
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode) return null;

    // 环形图专用处理逻辑，保留角度聚合
    return processForSunburst(targetNode, 7, 0, 0, t);
  }, [data, currentViewPath, t]);

  const treemapData = useMemo(() => {
    if (!data) return null;
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode) return null;

    // 矩形树图专用处理逻辑，不做角度聚合，尽可能保留细节
    return processForTreemap(targetNode, 7);
  }, [data, currentViewPath]);

  // Backward compatibility wrapper for other components that might rely on 'eChartsData'
  // But we should switch the view components to use the specific data
  const eChartsData = view === 'treemap' ? treemapData : sunburstData;

  const categoryData = useMemo(() => {
    // 性能优化：仅在图表视图下计算分类统计
    // Performance optimization: only calculate category stats in chart view
    if (view !== 'chart') return [];

    if (!data) return [];

    // Use current view node for statistics, or fallback to root data
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode) return [];

    const extensionMap = new Map<string, number>();

    const accumulate = (node: FileNode) => {
      if (node.is_dir) {
        if (node.children) {
          node.children.forEach(child => accumulate(child));
        }
        return;
      }
      const size = getNodeMetricSize(node);
      if (size === null) return;
      
      // Extract extension
      const parts = node.name.split('.');
      let ext = parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
      if (!ext) ext = 'no_ext'; // No extension
      
      extensionMap.set(ext, (extensionMap.get(ext) || 0) + size);
    };

    accumulate(targetNode);

    // Convert map to array and sort by size
    const sortedExtensions = Array.from(extensionMap.entries())
      .map(([ext, size]) => ({
        name: ext === 'no_ext' ? '(No Ext)' : `.${ext.toUpperCase()}`,
        value: size,
        formattedSize: formatSize(size),
        path: '',
        isDir: false,
      }))
      .sort((a, b) => b.value - a.value);

    // Take top 10 and group the rest into "Other"
    const topN = 12;
    if (sortedExtensions.length <= topN) {
      return sortedExtensions;
    }

    const topItems = sortedExtensions.slice(0, topN);
    const otherItems = sortedExtensions.slice(topN);
    const otherSize = otherItems.reduce((sum, item) => sum + item.value, 0);

    if (otherSize > 0) {
      topItems.push({
        name: t('categoryOther'),
        value: otherSize,
        formattedSize: formatSize(otherSize),
        path: '',
        isDir: false,
      });
    }

    return topItems;
  }, [data, currentViewPath, sizeMetric, t, view]);

  const [debouncedEChartsData, setDebouncedEChartsData] = useState(eChartsData);
  useEffect(() => {
    // 缩短 Treemap 的防抖时间以提高下钻响应速度
    // Reduce debounce time for Treemap to improve drill-down responsiveness
    const delay = view === 'treemap' ? 100 : 200;
    const timer = setTimeout(() => {
      setDebouncedEChartsData(eChartsData);
    }, delay);
    return () => clearTimeout(timer);
  }, [eChartsData, view]);

  /**
   * 处理图表点击下钻
   * Handle chart click drill-down
   */
  const handleChartDrillDown = async (path: string) => {
    if (!isTauri() || !data) return;
    
    // 检查节点是否存在于当前树中
    // Check if node exists in current tree
    const node = findNodeByPath(data, path);
    if (!node) {
        console.warn(`[handleChartDrillDown] Target node not found: ${path}`);
        return;
    }

    // 检查是否需要加载子目录数据
    if (node.is_dir && !node.children) {
      setLoading(true);
      try {
        const result = await invoke<FileNode>("analyze_directory", { path });
        
        setData(prev => {
          if (!prev) return null;
          let updatedNode = result;
          
          // 使用 applyBatchUpdates 替代 applySizeUpdate
          // Use applyBatchUpdates instead of applySizeUpdate
          const sUpdates = new Map<string, StructureUpdate>();
          const zUpdates = new Map(pendingUpdates.current);
          if (zUpdates.size > 0) {
                   // const affected = getAffectedPaths([zUpdates]);
                   const appliedPaths = new Set<string>();
                   const updatesByParent = buildUpdatesByParent(sUpdates);
                   updatedNode = applyBatchUpdates(updatedNode, sUpdates, zUpdates, new Set(), true, appliedPaths, updatesByParent);
                   
                   // Clear applied from pendingUpdates
                   for (const path of appliedPaths) {
                      pendingUpdates.current.delete(path);
                   }
              }
          
          pendingUpdates.current.delete(normalizePathForMatch(path));

          return updateNodeAtPath(prev, path, {
            children: updatedNode.children || [],
            size: updatedNode.size !== null ? updatedNode.size : findNodeByPath(prev, path)?.size || null,
            file_count: updatedNode.size !== null ? updatedNode.file_count : findNodeByPath(prev, path)?.file_count || 0
          });
        });
      } catch (err) {
        console.error(`Error loading ${path}:`, err);
      } finally {
        setLoading(false);
      }
    }
    setCurrentViewPath(path);
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

  /**
   * 返回根目录
   * Go back to root directory
   */
  const handleGoRoot = () => {
    if (!data) return;
    setCurrentViewPath(data.path);
  };

  return (
    <div
      className={cn(
        "h-screen flex flex-col bg-[#f8f9fa] dark:bg-[#0f1117] text-gray-900 dark:text-gray-100 font-sans overflow-hidden",
        isRTL && "rtl"
      )}
      dir={isRTL ? "rtl" : "ltr"}
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
              <h1 className="flex items-end gap-2">
                <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
                  {t('appTitle')}
                </span>
                <span className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-1">v{version}</span>
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
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/20 rounded-lg transition-colors border border-pink-200 dark:border-pink-800"
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
                  onClick={() => setView('chart')}
                  title={t('chartView')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'chart' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <BarChart3 size={16} />
                  <span className="hidden lg:inline">{t('chartView')}</span>
                </button>
                <button 
                  onClick={() => setView('fileType')}
                  title={t('fileTypeView')}
                  className={cn(
                    "px-3 py-1.5 rounded-md flex items-center gap-2 text-sm transition-all",
                    view === 'fileType' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <PieChart size={16} />
                  <span className="hidden lg:inline">{t('fileTypeView')}</span>
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
                <span className={cn(isMacOS() ? "inline" : "hidden sm:inline")}>{currentLanguageLabel}</span>
                <span className={cn(isMacOS() ? "hidden" : "sm:hidden")}>{languageMode === 'auto' ? 'Auto' : languageMode.toUpperCase()}</span>
              </button>
              {isLanguageMenuOpen && (
                <div className={cn(
                  "absolute mt-2 z-1000 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px]",
                  isRTL ? "left-0" : "right-0"
                )}>
                  <div className={cn(
                    "px-3 py-2 text-xs text-gray-500 dark:text-gray-400 select-none",
                    isRTL ? "text-right" : "text-left"
                  )}>
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
                        "w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700",
                        isRTL ? "text-right" : "text-left",
                        languageMode === opt.mode ? "bg-gray-100 dark:bg-gray-700" : "",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {data && (
              <>
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  title={t('refreshStats')}
                  className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 p-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={18} />
                </button>
              </>
            )}
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
            {scanProgress && (
              <div className="mt-4 text-center space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('scannedCount', { count: scanProgress.scanned_count.toLocaleString() })}
                </p>
                <p className="text-xs text-gray-400 max-w-md truncate px-4 mx-auto" title={scanProgress.current_path}>
                  {scanProgress.current_path}
                </p>
              </div>
            )}
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col h-full space-y-4">
            {view === 'tree' ? (
              <div className={cn("grid gap-4 shrink-0", isMacOS() ? "grid-cols-3" : "grid-cols-1 md:grid-cols-[1.2fr_1fr_0.8fr]")}>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                  <div className="text-gray-500 text-xs mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <HardDrive size={14} /> <span className="whitespace-nowrap">{t('totalSize')}</span>
                    </div>
                    <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md p-0.5 text-[10px] shrink-0">
                      <button
                        onClick={() => setSizeMetric('logical')}
                        className={cn(
                          "px-1.5 py-0.5 rounded-md transition-colors whitespace-nowrap",
                          sizeMetric === 'logical'
                            ? "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm"
                            : "text-gray-500 dark:text-gray-300"
                        )}
                      >
                        {t('metricLogical')}
                      </button>
                      <button
                        onClick={() => setSizeMetric('allocated')}
                        className={cn(
                          "px-1.5 py-0.5 rounded-md transition-colors whitespace-nowrap",
                          sizeMetric === 'allocated'
                            ? "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm"
                            : "text-gray-500 dark:text-gray-300"
                        )}
                      >
                        {t('metricAllocated')}
                      </button>
                    </div>
                  </div>
                  <div className="text-xl font-bold">
                    {(() => {
                      const { partialSize, hasPending } = getRealtimeSummary(data);
                      const isCalculating = hasPending || isReceivingUpdates;
                      const metricValue = sizeMetric === 'allocated' ? data.allocated_size : data.size;
                      if (metricValue === null) {
                        return (
                          <>
                            {formatSize(partialSize)}
                            {isCalculating && <span className="text-sm font-normal text-gray-500 ml-2">{t('calculatingInline')}</span>}
                          </>
                        );
                      }
                      return (
                        <>
                          {formatSize(metricValue)}
                          {isCalculating && <span className="text-sm font-normal text-gray-500 ml-2">{t('calculatingInline')}</span>}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1.5">
                    <Files size={14} /> {t('totalFiles')}
                  </div>
                  <div className="text-xl font-bold">
                    {(() => {
                      const { partialFileCount, hasPending } = getRealtimeSummary(data);
                      const isCalculating = hasPending || isReceivingUpdates;
                      const metricValue = sizeMetric === 'allocated' ? data.allocated_size : data.size;
                      const fileCountValue = metricValue === null ? partialFileCount : data.file_count;
                      return (
                        <>
                          {fileCountValue.toLocaleString(numberLocale)}
                          {isCalculating && <span className="text-sm font-normal text-gray-500 ml-2">{t('calculatingInline')}</span>}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1.5">
                    <Folder size={14} /> {t('rootDirectory')}
                  </div>
                  <div className="text-base font-semibold truncate" title={data.path as string}>
                    {data.name}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center w-full bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm shrink-0">
                {/* Total Size */}
                <div className="flex-1 flex items-center justify-center gap-2 min-w-0 px-2">
                  <div className="text-gray-500 flex items-center gap-1.5 shrink-0" title={t('totalSize')}>
                    <HardDrive size={16} /> 
                    <span className="text-xs hidden xl:inline">{t('totalSize')}</span>
                  </div>
                  <div className="text-sm font-bold flex items-center gap-2 truncate">
                    {(() => {
                      const { partialSize, hasPending } = getRealtimeSummary(data);
                      const isCalculating = hasPending || isReceivingUpdates;
                      const metricValue = sizeMetric === 'allocated' ? data.allocated_size : data.size;
                      const displayValue = metricValue === null ? formatSize(partialSize) : formatSize(metricValue);
                      return (
                        <>
                          {displayValue}
                          {isCalculating && <span className="text-xs font-normal text-gray-500 ml-1">{t('calculatingInline')}</span>}
                        </>
                      );
                    })()}
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded p-0.5 text-[9px] shrink-0">
                      <button
                        onClick={() => setSizeMetric('logical')}
                        className={cn(
                          "px-1.5 py-0.5 rounded transition-colors",
                          sizeMetric === 'logical' ? "bg-white dark:bg-gray-600 shadow-sm text-gray-800 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        )}
                        title={t('metricLogical')}
                      >
                        L
                      </button>
                      <button
                        onClick={() => setSizeMetric('allocated')}
                        className={cn(
                          "px-1.5 py-0.5 rounded transition-colors",
                          sizeMetric === 'allocated' ? "bg-white dark:bg-gray-600 shadow-sm text-gray-800 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        )}
                        title={t('metricAllocated')}
                      >
                        A
                      </button>
                    </div>
                  </div>
                </div>

                <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />

                {/* File Count */}
                <div className="flex-1 flex items-center justify-center gap-2 min-w-0 px-2">
                  <div className="text-gray-500 flex items-center gap-1.5 shrink-0" title={t('totalFiles')}>
                    <Files size={16} /> 
                    <span className="text-xs hidden xl:inline">{t('totalFiles')}</span>
                  </div>
                  <div className="text-sm font-bold truncate">
                    {(() => {
                      const { partialFileCount, hasPending } = getRealtimeSummary(data);
                      const isCalculating = hasPending || isReceivingUpdates;
                      const metricValue = sizeMetric === 'allocated' ? data.allocated_size : data.size;
                      const fileCountValue = metricValue === null ? partialFileCount : data.file_count;
                      return (
                        <>
                          {fileCountValue.toLocaleString(numberLocale)}
                          {isCalculating && <span className="text-xs font-normal text-gray-500 ml-1">{t('calculatingInline')}</span>}
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />

                {/* Root Directory */}
                <div className="flex-1 flex items-center justify-center gap-2 min-w-0 px-2">
                  <div className="text-gray-500 flex items-center gap-1.5 shrink-0" title={t('rootDirectory')}>
                    <Folder size={16} /> 
                    <span className="text-xs hidden xl:inline">{t('rootDirectory')}</span>
                  </div>
                  <div className="text-sm font-semibold truncate max-w-[200px]" title={data.path as string}>
                    {data.name}
                  </div>
                </div>
              </div>
            )}

            <div ref={fileListRef} className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col relative">
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
                      diskStats={diskStats}
                      expandedPaths={expandedPaths}
                      loadingPaths={loadingPaths}
                      onToggleExpand={toggleExpand}
                      onContextMenu={handleContextMenu}
                      t={t}
                      isRTL={isRTL}
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
                    <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
                      <TreemapView 
                        data={debouncedEChartsData}
                        t={t}
                        isRTL={isRTL}
                        onDrillDown={handleChartDrillDown}
                        onGoUp={handleGoUp}
                        onGoRoot={handleGoRoot}
                        onContextMenu={handleContextMenu}
                        canGoUp={!!currentViewPath && normalizePathForMatch(currentViewPath) !== normalizePathForMatch(data.path)}
                        currentPath={currentViewPath || data.path}
                      />
                    </Suspense>
                  </motion.div>
                ) : view === 'fileType' ? (
                  <motion.div
                    key="fileType"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 overflow-hidden"
                  >
                    <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
                      <FileTypeView 
                        data={data}
                        t={t}
                        isRTL={isRTL}
                        onContextMenu={handleContextMenu}
                      />
                    </Suspense>
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
                    <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
                      <ChartView 
                        chartData={debouncedEChartsData}
                        categoryData={categoryData}
                        t={t}
                        isRTL={isRTL}
                        onDrillDown={handleChartDrillDown}
                        onGoUp={handleGoUp}
                        onGoRoot={handleGoRoot}
                        onContextMenu={handleContextMenu}
                        canGoUp={!!currentViewPath && normalizePathForMatch(currentViewPath) !== normalizePathForMatch(data.path)}
                        currentPath={currentViewPath || data.path}
                      />
                    </Suspense>
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
        isRTL={isRTL}
      />

      {/* 评分弹窗 / Rate Modal */}
      <RateModal 
        isOpen={isRateModalOpen} 
        onClose={() => setIsRateModalOpen(false)} 
        t={t}
        isRTL={isRTL}
      />
    </div>
  );
}

export default App;
