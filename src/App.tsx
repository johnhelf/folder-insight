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
  RefreshCw
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { formatSize, cn, isTauri, isMacOS } from "./utils";
import {
  createTranslator,
  detectSystemLocale,
  getInitialLanguageMode,
  getLocaleNativeName,
  persistLanguageMode,
  resolveLocale,
  type LanguageMode,
} from "./i18n";
import { processForECharts } from "./chartHelpers";
import { FileNode, SizeUpdate, StructureUpdate, BatchStructureUpdate, BatchSizeUpdate } from "./types";
import { SponsorModal } from "./components/SponsorModal";
import { TreeView } from "./components/TreeView";
// import { ChartView } from "./components/ChartView";
// import { TreemapView } from "./components/TreemapView";

const ChartView = lazy(() => import("./components/ChartView").then(module => ({ default: module.ChartView })));
const TreemapView = lazy(() => import("./components/TreemapView").then(module => ({ default: module.TreemapView })));

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
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getInitialLanguageMode());
  const [systemLocale, setSystemLocale] = useState(detectSystemLocale());
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isSponsorModalOpen, setIsSponsorModalOpen] = useState(false);
  const [sizeMetric, setSizeMetric] = useState<'logical' | 'allocated'>('logical');
  const [isReceivingUpdates, setIsReceivingUpdates] = useState(false);
  // const [isRealtimePaused, setIsRealtimePaused] = useState(false); // 移除暂停功能 / Remove pause feature
  const pendingUpdates = useRef<Map<string, SizeUpdate>>(new Map());
  const pendingStructureUpdates = useRef<Map<string, StructureUpdate>>(new Map());
  const updateTimeoutRef = useRef<number | null>(null);
  const isUpdateScheduled = useRef(false);
  // const pausedUpdates = useRef<Map<string, SizeUpdate>>(new Map());
  const needsSort = useRef(false);

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
  const isRTL = locale === 'ar';
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
   */
  const applyBatchUpdates = (
    node: FileNode,
    structureUpdates: Map<string, StructureUpdate>,
    sizeUpdates: Map<string, SizeUpdate>,
    affectedPaths: Set<string>,
    _isRoot: boolean = false,
    appliedPaths: Set<string>
  ): FileNode => {
    const normalizedPath = normalizePathForMatch(node.path);
    
    // Debugging: Log path matching for root or first level children to verify normalization
    // 调试：记录根节点或第一层子节点的路径匹配情况，验证标准化逻辑
    if (_isRoot && structureUpdates.size > 0) {
        // console.log(`[applyBatchUpdates] Root path: ${normalizedPath}. Pending structure updates: ${structureUpdates.size}`);
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
          // If the child already exists, preserve its children and stats
          // Structure updates from backend often have empty stats for directories (size: null, etc.)
          // We must not overwrite existing calculated stats with null/empty values.
          return {
            ...newChild,
            // Preserve deep structure
            // 修复：防止空数组覆盖已有的子节点数据
            // Fix: prevent empty array from overwriting existing children data
            children: (newChild.children && newChild.children.length > 0) ? newChild.children : prevChild.children,
            // Preserve calculated stats if newChild doesn't have them (e.g. it's a directory entry from a structure scan)
            size: newChild.size ?? prevChild.size,
            allocated_size: newChild.allocated_size ?? prevChild.allocated_size,
            // Preserve file_count for directories (Rust sends 0 for dirs in structure update)
            file_count: (newChild.is_dir && !newChild.file_count) ? prevChild.file_count : newChild.file_count,
            is_restricted: prevChild.is_restricted || newChild.is_restricted,
          };
        }
        return newChild;
      });

      newNode = { ...newNode, children: mergedChildren };
    }

    // 2. 应用大小更新 / Apply size update
    if (sizeUpdates.has(normalizedPath)) {
      appliedPaths.add(normalizedPath); // Mark as applied
      const update = sizeUpdates.get(normalizedPath)!;
      newNode = {
        ...newNode,
        size: update.size,
        allocated_size: update.allocated_size,
        is_restricted: update.is_restricted,
        file_count: update.file_count,
      };
    }

    // 3. 递归处理子节点 / Recurse into children
    if (!newNode.children) return newNode;

    let childrenChanged = false;
    const newChildren = newNode.children.map(child => {
      // 这里的 affectedPaths 参数已经不再被使用，但为了兼容性保留
      // affectedPaths parameter is unused now but kept for compatibility
      const newChild = applyBatchUpdates(child, structureUpdates, sizeUpdates, affectedPaths, false, appliedPaths);
      if (newChild !== child) childrenChanged = true;
      return newChild;
    });

    if (childrenChanged || newNode !== node) {
      return { ...newNode, children: newChildren };
    }

    return node;
  };

  /**
   * 生成所有受影响路径及其祖先路径的集合
   * Generate set of all affected paths and their ancestors
   */
  // const getAffectedPaths = (updatesList: Map<string, any>[]): Set<string> => {
  //   const affected = new Set<string>();
  //   updatesList.forEach(map => {
  //     for (const rawPath of map.keys()) {
  //       // 确保使用统一的标准化逻辑
  //       // Ensure consistent normalization
  //       let current = normalizePathForMatch(rawPath);
  //       
  //       affected.add(current);
  //       
  //       // 向上遍历添加所有祖先 / Traverse up to add all ancestors
  //       while (true) {
  //         const lastSlash = current.lastIndexOf('/');
  //         if (lastSlash === -1) break;
  //         
  //         current = current.substring(0, lastSlash);
  //         
  //         // 避免添加空字符串（如果路径是 /foo，substring(0,0) 是空）
  //         // Avoid adding empty string
  //         if (current.length > 0) {
  //           affected.add(current);
  //         } else {
  //           // 如果是根路径 "/"，可能需要根据具体逻辑处理，但在 Windows 上通常是 "c:"
  //           // If root path "/", handled differently, but on Windows usually "c:"
  //           break; 
  //         }
  //       }
  //     }
  //   });
  //   return affected;
  // };

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
      
      const sUpdates = new Map(pendingStructureUpdates.current);
      const zUpdates = new Map(pendingUpdates.current);
      
      // 使用 applyBatchUpdates 批量处理，确保正确合并
      // Use applyBatchUpdates for batch processing to ensure correct merging
      if (sUpdates.size > 0 || zUpdates.size > 0) {
        // const affected = getAffectedPaths([sUpdates, zUpdates]);
        // console.log(`[analyzePath] Applying updates. Affected paths: ${affected.size}`);
        console.log(`[analyzePath] Applying updates. Structure: ${sUpdates.size}, Size: ${zUpdates.size}`);
        const appliedPaths = new Set<string>();
        updatedResult = applyBatchUpdates(updatedResult, sUpdates, zUpdates, new Set(), true, appliedPaths);
        
        // Remove applied
        for (const path of appliedPaths) {
            pendingStructureUpdates.current.delete(path);
            pendingUpdates.current.delete(path);
        }
      } else {
        console.log(`[analyzePath] No pending updates to apply.`);
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


  useEffect(() => {
    if (!isTauri()) return;

    // 调度更新：如果这是第一个待处理的更新（无论是结构还是大小），则设置定时器
    // Schedule update: if this is the first pending update (structure or size), set timeout
    const scheduleUpdate = () => {
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

          // IMPORTANT: Read refs inside setData to ensure we handle current state
          // 创建更新 Map 的快照
          const sUpdates = new Map(pendingStructureUpdates.current);
          const zUpdates = new Map(pendingUpdates.current);
          
          if (sUpdates.size === 0 && zUpdates.size === 0) {
            return prev;
          }

          console.log(`Processing batch updates: ${sUpdates.size} structure, ${zUpdates.size} size`);
          
          // 3. 关键修复：不再清空所有 pendingUpdates！
          //    只在 applyBatchUpdates 返回后，根据实际被应用的 updates 来清理？
          //    或者，在 applyBatchUpdates 中返回“未被应用的 updates”？
          //    
          //    由于 React 状态更新是异步的，我们不能轻易知道哪些 updates 被应用了。
          //    但是，我们的 applyBatchUpdates 是同步遍历整个树。
          //    如果树中不存在该节点，则 update 不会被应用。
          //    
          //    为了简单且安全：
          //    我们将 pendingUpdates 清空，但在 applyBatchUpdates 中，如果遇到未应用的 updates，我们需要重新放回 pendingUpdates？
          //    不，这样太复杂。
          //
          //    更好的策略：
          //    每次只清空 pendingStructureUpdates（因为结构更新通常是添加新节点，一旦添加就不需要了）。
          //    对于 pendingUpdates (Size)，我们需要确保它们的目标节点存在。
          //    
          //    如果结构更新先于大小更新到达，那么结构更新会创建节点，大小更新随后应用。
          //    如果大小更新先于结构更新到达（或者同时到达但处理顺序问题），
          //    applyBatchUpdates 会先处理结构更新（创建节点），再处理大小更新。
          //    
          //    唯一的问题是：如果结构更新 **缺失**（例如网络丢包，或者逻辑错误），那么大小更新就永远找不到节点。
          //    
          //    但是，如果结构更新在 pendingStructureUpdates 中，它一定会被应用（只要父节点存在）。
          //    如果父节点也不存在？那说明祖先的结构更新也没到。
          //    
          //    所以，只要我们保证 pendingStructureUpdates 和 pendingUpdates 一起传给 applyBatchUpdates，
          //    并且 applyBatchUpdates 先应用结构，再应用大小，这就应该没问题。
          //    
          //    除非：applyBatchUpdates 的遍历逻辑有漏洞，导致某些节点被跳过。
          //    
          //    之前的逻辑是：pendingUpdates.current.clear()。
          //    这假设所有 updates 都能在当前这一轮被应用。
          //    如果当前树中确实没有这个节点（比如结构更新还没来），那这个 size update 就丢了。
          //    
          //    修复方案：
          //    引入一个机制，记录哪些 path 被成功更新了。
          //    或者，简单地：不清除 pendingUpdates，除非确认节点已存在？
          //    
          //    但这会导致 pendingUpdates 无限膨胀。
          //    
          //    折衷方案：
          //    给 pendingUpdates 设置一个 TTL？或者重试次数？
          //    
          //    让我们回看 applyBatchUpdates。它遍历整个树。
          //    如果 sizeUpdates 包含 "A/B"，但树里只有 "A"，且 structureUpdates 不包含 "A/B"。
          //    那么 "A/B" 的 size update 无法应用。
          //    这种情况发生于：SizeUpdate(B) 到了，但 StructureUpdate(B) 还没到。
          //    
          //    此时，我们应该 **保留** SizeUpdate(B) 在 pendingUpdates 中！
          //    
          //    Implementation:
          //    1. Pass a set to applyBatchUpdates to collect "applied paths".
          //    2. After applyBatchUpdates, clear only the applied paths from pendingUpdates.current.
          
          const appliedPaths = new Set<string>();
          const updatedTree = applyBatchUpdates(prev, sUpdates, zUpdates, new Set(), true, appliedPaths);
          
          // 清理已应用的结构更新
          // Clear applied structure updates
          // Structure updates are generally "one-off", if applied, clear.
          // If not applied (parent missing), should we keep them?
          // Yes, same logic applies to structure updates!
          // If we receive Structure(GrandChild) but not Structure(Child), GrandChild cannot be added.
          
          // Let's modify applyBatchUpdates to track applied structure updates too?
          // Actually, if we just keep everything that wasn't applied, it's safer.
          
          // Update: applyBatchUpdates now takes `appliedPaths` set.
          
          // Remove applied updates from refs
          for (const path of appliedPaths) {
             pendingStructureUpdates.current.delete(path);
             pendingUpdates.current.delete(path);
          }
          
          // Log remaining (unapplied) updates count
          if (pendingStructureUpdates.current.size > 0 || pendingUpdates.current.size > 0) {
              console.log(`[scheduleUpdate] Unapplied updates retained: ${pendingStructureUpdates.current.size} structure, ${pendingUpdates.current.size} size`);
          }

          console.log(`[scheduleUpdate] Applied ${appliedPaths.size} updates.`);
          
          // 只有在数据真正变化时才重新排序
          // Only resort if data changed
          return sortTreeRecursive(updatedTree); 
        });
      }, 500);
    };

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
    try {
      setLoading(true);
      const result = await invoke<FileNode>("analyze_directory", { path: targetPath });

      // 应用加载期间积累的所有更新，避免被浅层扫描覆盖
      // Apply all updates accumulated during loading to avoid overwriting with shallow scan
      let updatedResult = result;
      const sUpdates = new Map(pendingStructureUpdates.current);
      const zUpdates = new Map(pendingUpdates.current);
      
      console.log(`[handleRefresh] Structure updates: ${sUpdates.size}, Size updates: ${zUpdates.size}`);
      if (sUpdates.size > 0 || zUpdates.size > 0) {
        // const affected = getAffectedPaths([sUpdates, zUpdates]);
        const appliedPaths = new Set<string>();
        updatedResult = applyBatchUpdates(updatedResult, sUpdates, zUpdates, new Set(), true, appliedPaths);
        
        // Clear applied updates from refs
        for (const path of appliedPaths) {
            pendingStructureUpdates.current.delete(path);
            pendingUpdates.current.delete(path);
        }
      }
      
      // 不再盲目清理所有 updates
      // Don't blindly clear all updates anymore
      // pendingStructureUpdates.current.clear();
      // pendingUpdates.current.clear();

      setData(prev => {
        if (!prev) return updatedResult;
        
        // 如果是根目录刷新，直接替换整个树
        // If refreshing root, replace the whole tree
        if (normalizePathForMatch(targetPath) === normalizePathForMatch(prev.path)) {
            return sortTreeRecursive(updatedResult);
        }

        // 如果是子目录刷新，替换对应子树
        // If refreshing subdirectory, replace corresponding subtree
        return sortTreeRecursive(updateNodeAtPath(prev, targetPath, {
            ...updatedResult,
            // 确保保留原有的父级关联（虽然 updateNodeAtPath 会处理，但为了保险）
            // Ensure parent association is kept (handled by updateNodeAtPath but to be safe)
        }));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
            
            // 使用 applyBatchUpdates 替代已删除的 applySizeUpdate
            // Use applyBatchUpdates instead of deleted applySizeUpdate
            const sUpdates = new Map<string, StructureUpdate>();
            const zUpdates = new Map(pendingUpdates.current);
            // 只需要当前节点及其子节点的更新，但 applyBatchUpdates 会处理过滤
            // Just need updates for current node and children, applyBatchUpdates handles filtering
            
            if (zUpdates.size > 0) {
                 // const affected = getAffectedPaths([zUpdates]);
                 const appliedPaths = new Set<string>();
                 updatedNode = applyBatchUpdates(updatedNode, sUpdates, zUpdates, new Set(), true, appliedPaths);
                 
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
   * 统计图数据：生成 ECharts 需要的树形结构
   * Chart dataset: generate tree structure for ECharts
   */
  const eChartsData = useMemo(() => {
    if (!data) return null;
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode) return null;

    // 根据当前视图生成 ECharts 数据，聚合阈值设为 0.5% 以显示更多细节
    // Generate ECharts data, threshold 0.5% to show more details
    // 增加递归深度到 7，确保环形图和矩形树图都能获得足够深的数据
    // Increase recursion depth to 7
    return processForECharts(targetNode, 7, 0.001);
  }, [data, currentViewPath]);

  const categoryData = useMemo(() => {
    if (!data) return [];

    const systemExts = new Set(['sys', 'dll', 'drv', 'ocx']);
    const softwareExts = new Set(['exe', 'msi', 'app', 'appx', 'apk', 'deb', 'rpm', 'bat', 'cmd', 'ps1', 'sh']);
    const gameExts = new Set(['pak', 'unity3d', 'umap', 'ubulk', 'uexp', 'wad', 'obb']);
    const videoExts = new Set(['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'm4v']);
    const audioExts = new Set(['mp3', 'flac', 'aac', 'wav', 'ogg', 'm4a', 'wma']);
    const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico']);
    const documentExts = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'rtf', 'csv']);

    const totals = new Map<string, number>();

    const detectCategory = (name: string) => {
      const ext = name.toLowerCase().split('.').pop() || '';
      if (systemExts.has(ext)) return 'system';
      if (softwareExts.has(ext)) return 'software';
      if (gameExts.has(ext)) return 'game';
      if (videoExts.has(ext)) return 'video';
      if (audioExts.has(ext)) return 'audio';
      if (imageExts.has(ext)) return 'image';
      if (documentExts.has(ext)) return 'document';
      return 'other';
    };

    const accumulate = (node: FileNode) => {
      if (node.is_dir) {
        if (node.children) {
          node.children.forEach(child => accumulate(child));
        }
        return;
      }
      const size = getNodeMetricSize(node);
      if (size === null) return;
      const key = detectCategory(node.name);
      totals.set(key, (totals.get(key) || 0) + size);
    };

    accumulate(data);

    const labelMap: Record<string, string> = {
      system: t('categorySystem'),
      software: t('categorySoftware'),
      game: t('categoryGame'),
      video: t('categoryVideo'),
      audio: t('categoryAudio'),
      image: t('categoryImage'),
      document: t('categoryDocument'),
      other: t('categoryOther'),
    };

    const items = Object.entries(labelMap)
      .map(([key, label]) => {
        const value = totals.get(key) || 0;
        return {
          name: label,
          value,
          formattedSize: formatSize(value),
          path: '',
          isDir: false,
        };
      })
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);

    return items;
  }, [data, sizeMetric, t]);

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
                   updatedNode = applyBatchUpdates(updatedNode, sUpdates, zUpdates, new Set(), true, appliedPaths);
                   
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
                  "absolute mt-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px]",
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
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col h-full space-y-4">
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
                      expandedPaths={expandedPaths}
                      loadingPaths={loadingPaths}
                      onToggleExpand={toggleExpand}
                      onContextMenu={handleContextMenu}
                    t={t}
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
                        onDrillDown={handleChartDrillDown}
                        onGoUp={handleGoUp}
                        canGoUp={!!currentViewPath && normalizePathForMatch(currentViewPath) !== normalizePathForMatch(data.path)}
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
                        onDrillDown={handleChartDrillDown}
                        onGoUp={handleGoUp}
                        canGoUp={!!currentViewPath && normalizePathForMatch(currentViewPath) !== normalizePathForMatch(data.path)}
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
      />
    </div>
  );
}

export default App;
