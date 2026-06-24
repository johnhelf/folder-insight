import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { formatSize, isTauri, isWindows } from "../utils";
import {
  createTranslator,
  detectSystemLocale,
  getInitialLanguageMode,
  persistLanguageMode,
  resolveLocale,
  isRTLLocale,
  type LanguageMode,
} from "../i18n";
import { processForSunburst, processForTreemap } from '../chartHelpers';
import { FileNode, SizeUpdate, StructureUpdate, BatchStructureUpdate, BatchSizeUpdate, DiskStats, ProgressUpdate, PhysicalDisk } from "../types";
import {
  normalizePathForMatch,
  sortTreeRecursive,
  findNodeByPath,
  updateNodeAtPath,
  buildUpdatesByParent,
  getAffectedPaths,
  applyBatchUpdates,
  getNodeMetricSize
} from "../utils/treeUtils";


export function useAppLogic() {
  const [data, setData] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [diskStats, setDiskStats] = useState<DiskStats | null>(null);
  const [scanProgress, setScanProgress] = useState<ProgressUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'chart' | 'treemap' | 'fileType' | 'duplicates' | 'aiInsights'>('tree');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const [currentViewPath, setCurrentViewPath] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>(getInitialLanguageMode());
  const [systemLocale, setSystemLocale] = useState(detectSystemLocale());
  const [isSponsorModalOpen, setIsSponsorModalOpen] = useState(false);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [sizeMetric, setSizeMetric] = useState<'logical' | 'allocated'>('logical');
  const [isReceivingUpdates, setIsReceivingUpdates] = useState(false);
  const [availableDisks, setAvailableDisks] = useState<DiskStats[]>([]);
  const [physicalDisks, setPhysicalDisks] = useState<PhysicalDisk[]>([]); // physical disks
  
  const pendingUpdates = useRef<Map<string, SizeUpdate>>(new Map());
  const pendingStructureUpdates = useRef<Map<string, StructureUpdate>>(new Map());
  const updateTimeoutRef = useRef<number | null>(null);
  const isUpdateScheduled = useRef(false);
  const needsSort = useRef(false);
  const isRefreshing = useRef(false); 
  const hasCheckedModalRef = useRef(false);
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const [isBackgroundScanning, setIsBackgroundScanning] = useState(false);
  const isScanning = loading || scanProgress !== null || isReceivingUpdates || isBackgroundScanning;
  const isScanningRef = useRef(isScanning);

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

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

  const scheduleUpdate = useCallback(() => {
    if (isUpdateScheduled.current) return;
    isUpdateScheduled.current = true;

    setTimeout(() => {
      isUpdateScheduled.current = false;

      const sUpdates = new Map(pendingStructureUpdates.current);
      const zUpdates = new Map(pendingUpdates.current);
      
      if (sUpdates.size === 0 && zUpdates.size === 0) {
        return;
      }

      // Clear the queues BEFORE React state updater to avoid Strict Mode double-invocation bug
      pendingStructureUpdates.current.clear();
      pendingUpdates.current.clear();

      setData((prev) => {
        if (!prev) {
          return null;
        }

        if (isRefreshing.current) {
          return prev;
        }

        console.log(`Processing batch updates: ${sUpdates.size} structure, ${zUpdates.size} size`);
        
        const affected = getAffectedPaths([sUpdates, zUpdates]);
        const appliedPaths = new Set<string>();
        const updatesByParent = buildUpdatesByParent(sUpdates);
        const updatedTree = applyBatchUpdates(prev, sUpdates, zUpdates, affected, true, appliedPaths, updatesByParent);
        
        return updatedTree;
      });
    }, 200);
  }, []);

  // --- Effects ---

  // 快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 定时排序逻辑
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
  useEffect(() => {
    if (!isTauri()) return;
    
    const unlistenPromise = listen<ProgressUpdate>('scan-progress', (event) => {
        setScanProgress(event.payload);
    });

    const unlistenCompletePromise = listen('scan-complete', () => {
        setScanProgress(null);
        setIsBackgroundScanning(false);
        // 扫描完成，强制最后一次排序更新
        needsSort.current = true;
        scheduleUpdate();
    });

    const unlistenCancelledPromise = listen('scan-cancelled', () => {
        setScanProgress(null);
        setIsBackgroundScanning(false);
        setLoading(false);
        needsSort.current = true;
        scheduleUpdate();
    });

    return () => {
        unlistenPromise.then(unlisten => unlisten());
        unlistenCompletePromise.then(unlisten => unlisten());
        unlistenCancelledPromise.then(unlisten => unlisten());
    };
  }, [scheduleUpdate]);

  // 弹窗自动弹出逻辑 (赞助 & 评分)
  useEffect(() => {
    if (!isTauri()) return;
    if (hasCheckedModalRef.current) return;
    hasCheckedModalRef.current = true;

    const now = Date.now();
    const FIRST_RUN_TIME_KEY = 'first_run_time';
    const HAS_SHOWN_SPONSOR_KEY = 'has_shown_sponsor_modal';
    const HAS_SHOWN_RATE_KEY = 'has_shown_rate_modal';
    const LAST_MODAL_SHOW_TIME_KEY = 'last_modal_show_time';
    
    let firstRunTime = parseInt(localStorage.getItem(FIRST_RUN_TIME_KEY) || '0', 10);
    if (firstRunTime === 0) {
      firstRunTime = now;
      localStorage.setItem(FIRST_RUN_TIME_KEY, now.toString());
    }

    if (now - firstRunTime < 3 * 24 * 60 * 60 * 1000) {
      return;
    }

    let hasShownSponsor = localStorage.getItem(HAS_SHOWN_SPONSOR_KEY) === 'true';
    let hasShownRate = localStorage.getItem(HAS_SHOWN_RATE_KEY) === 'true';

    if (hasShownSponsor && hasShownRate) {
      hasShownSponsor = false;
      hasShownRate = false;
      localStorage.setItem(HAS_SHOWN_SPONSOR_KEY, 'false');
      localStorage.setItem(HAS_SHOWN_RATE_KEY, 'false');
    }

    if (isSponsorModalOpen || isRateModalOpen) {
      return;
    }
    
    if (!hasShownSponsor) {
      setIsSponsorModalOpen(true);
      localStorage.setItem(HAS_SHOWN_SPONSOR_KEY, 'true');
      localStorage.setItem(LAST_MODAL_SHOW_TIME_KEY, now.toString());
    } else if (!hasShownRate) {
      if (isWindows()) {
        setIsRateModalOpen(true);
        localStorage.setItem(HAS_SHOWN_RATE_KEY, 'true');
        localStorage.setItem(LAST_MODAL_SHOW_TIME_KEY, now.toString());
      } else {
        localStorage.setItem(HAS_SHOWN_RATE_KEY, 'true');
      }
    }
  }, []);

  useEffect(() => {
    persistLanguageMode(languageMode);
  }, [languageMode]);

  useEffect(() => {
    const handler = () => setSystemLocale(detectSystemLocale());
    window.addEventListener('languagechange', handler as EventListener);
    return () => window.removeEventListener('languagechange', handler as EventListener);
  }, []);

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const refreshDrives = useCallback(async () => {
    if (!isTauri()) return;
    try {
        const disks = await invoke<DiskStats[]>('get_all_disk_stats');
        setAvailableDisks(disks);
        const pDisks = await invoke<PhysicalDisk[]>('get_physical_disks').catch(() => []);
        setPhysicalDisks(pDisks);
    } catch (e) {
        console.error("Failed to fetch disks:", e);
    }
  }, []);

  useEffect(() => {
    refreshDrives();
  }, [refreshDrives]);

  // --- Logic Functions ---

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

    const unlistenSizePromise = listen<SizeUpdate>('folder-size-updated', (event) => {
      markUpdating();
      const update = event.payload;
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

    const unlistenStructurePromise = listen<StructureUpdate>('folder-structure-updated', (event) => {
      markUpdating();
      const update = event.payload;
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
  }, [scheduleUpdate]);

  const analyzePath = useCallback(async (path: string) => {
    if (!isTauri()) {
      setError("Please run this app inside Tauri to use file scanning features.");
      return;
    }
    try {
        setLoading(true);
        setIsBackgroundScanning(true);
        setScanStartTime(Date.now());
        setError(null);
      setData(null);
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
      
      let updatedResult = result;
      
      const sUpdates = new Map(pendingStructureUpdates.current);
      const zUpdates = new Map(pendingUpdates.current);
      
      pendingStructureUpdates.current.clear();
      pendingUpdates.current.clear();
      
      if (sUpdates.size > 0 || zUpdates.size > 0) {
        const affected = new Set<string>(); 
        const appliedPaths = new Set<string>();
        const updatesByParent = buildUpdatesByParent(sUpdates);
        updatedResult = applyBatchUpdates(updatedResult, sUpdates, zUpdates, affected, true, appliedPaths, updatesByParent);
      }
      
      setData(sortTreeRecursive(updatedResult));
      setCurrentViewPath(updatedResult.path);
      setExpandedPaths(new Set([result.path as string]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsBackgroundScanning(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    // 使用计数器解决拖拽进入子元素时频繁触发 leave/enter 的问题
    // Use a counter to solve the problem of frequent leave/enter when dragging over child elements
    let dragCounter = 0;

    // Tauri v2 webview-level drag drop event handling
    let unlistenDragDrop: (() => void) | null = null;
    
    const setupDragDrop = async () => {
      const webview = getCurrentWebview();
      unlistenDragDrop = await webview.onDragDropEvent((event) => {
        if (event.payload.type === 'enter') {
          dragCounter++;
          setIsDragActive(true);
        } else if (event.payload.type === 'over') {
          // Keep active
          setIsDragActive(true);
        } else if (event.payload.type === 'leave') {
          dragCounter--;
          if (dragCounter <= 0) {
            dragCounter = 0;
            setIsDragActive(false);
          }
        } else if (event.payload.type === 'drop') {
          dragCounter = 0;
          setIsDragActive(false);
          const paths = event.payload.paths;
          const [firstPath] = paths;
          if (firstPath) {
            console.log("File dropped:", firstPath);
            if (isScanningRef.current) {
                confirm(t('scanInProgressMessage'), { title: t('scanInProgressTitle'), kind: 'warning' })
                  .then(confirmed => {
                    if (confirmed) analyzePath(firstPath);
                  });
            } else {
                analyzePath(firstPath);
            }
          }
        }
      });
    };

    setupDragDrop();

    return () => {
      if (unlistenDragDrop) unlistenDragDrop();
    };
  }, [analyzePath, t]);

  const analyzeFullDisk = useCallback(async () => {
    if (!isTauri()) {
      setError("Please run this app inside Tauri to use file scanning features.");
      return;
    }

    if (isScanning) {
      const confirmed = await confirm(t('scanInProgressMessage'), { title: t('scanInProgressTitle'), kind: 'warning' });
      if (!confirmed) return;
    }

    const confirmed = await confirm(t('fullScanMessage'), { title: t('fullScanTitle'), kind: 'info' });
    if (!confirmed) return;

    try {
      setLoading(true);
      setIsBackgroundScanning(true);
      setScanStartTime(Date.now());
        setError(null);
      setData(null);
      setContextMenu(null);
      setExpandedPaths(new Set());
      setLoadingPaths(new Set());
      setScanProgress(null);
      setDiskStats(null);

      const result = await invoke<FileNode>("analyze_directory", { path: "ALL_DISKS" });
      
      let updatedResult = result;
      
      const sUpdates = new Map(pendingStructureUpdates.current);
      const zUpdates = new Map(pendingUpdates.current);
      
      pendingStructureUpdates.current.clear();
      pendingUpdates.current.clear();
      
      if (sUpdates.size > 0 || zUpdates.size > 0) {
        const affected = new Set<string>(); 
        const appliedPaths = new Set<string>();
        const updatesByParent = buildUpdatesByParent(sUpdates);
        updatedResult = applyBatchUpdates(updatedResult, sUpdates, zUpdates, affected, true, appliedPaths, updatesByParent);
      }
      
      setData(sortTreeRecursive(updatedResult));
      setCurrentViewPath(updatedResult.path);

    } catch (err) {
      console.error(err);
      setError(typeof err === "string" ? err : "Failed to start full disk scan");
      setIsBackgroundScanning(false);
    } finally {
      setLoading(false);
    }
  }, [t, loading]);

  const handleSelectDrive = useCallback(async (drivePath: string) => {
      if (isScanning) {
         const confirmed = await confirm(t('scanInProgressMessage'), { title: t('scanInProgressTitle'), kind: 'warning' });
         if (!confirmed) return;
      }
      analyzePath(drivePath);
  }, [isScanning, t, analyzePath]);

  const handleSelectFolder = async () => {
    if (!isTauri()) {
      setError("Please run this app inside Tauri to use file scanning features.");
      return;
    }

    if (isScanning) {
      const confirmed = await confirm(t('scanInProgressMessage'), { title: t('scanInProgressTitle'), kind: 'warning' });
      if (!confirmed) return;
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
    analyzePath(targetPath);
  };

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
          const result = await invoke<FileNode>("expand_directory", { path });

          setData(prev => {
            if (!prev) return null;
            
            let updatedNode = result;
            
            const sUpdates = new Map(pendingStructureUpdates.current);
            const zUpdates = new Map(pendingUpdates.current);
            
            pendingStructureUpdates.current.clear();
            pendingUpdates.current.clear();
            
            if (sUpdates.size > 0 || zUpdates.size > 0) {
                 const appliedPaths = new Set<string>();
                 const updatesByParent = buildUpdatesByParent(sUpdates);
                 updatedNode = applyBatchUpdates(updatedNode, sUpdates, zUpdates, new Set(), true, appliedPaths, updatesByParent);
                 
                 // Note: we still need to apply these updates to the REST of the tree!
                 // But updatedNode is only the sub-tree. 
                 // It's safer to let the normal scheduleUpdate handle the rest, 
                 // but since we cleared the queues, we must apply them to the FULL tree!
                 // So we should apply them to prev first, THEN update the node.
                 prev = applyBatchUpdates(prev, sUpdates, zUpdates, getAffectedPaths([sUpdates, zUpdates]), true, appliedPaths, updatesByParent);
            }

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

  const handleContextMenu = (e: React.MouseEvent | MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      path,
    });
  };

  const handleGlobalContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu(null);
  };

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

  const handleChartDrillDown = async (path: string) => {
    if (!isTauri() || !data) return;
    
    const node = findNodeByPath(data, path);
    if (!node) {
        console.warn(`[handleChartDrillDown] Target node not found: ${path}`);
        return;
    }

    if (node.is_dir && !node.children) {
      setLoading(true);
      try {
        const result = await invoke<FileNode>("expand_directory", { path });
        
        setData(prev => {
          if (!prev) return null;
          let updatedNode = result;
          
          const sUpdates = new Map(pendingStructureUpdates.current);
          const zUpdates = new Map(pendingUpdates.current);
          
          pendingStructureUpdates.current.clear();
          pendingUpdates.current.clear();
          
          if (sUpdates.size > 0 || zUpdates.size > 0) {
               const appliedPaths = new Set<string>();
               const updatesByParent = buildUpdatesByParent(sUpdates);
               updatedNode = applyBatchUpdates(updatedNode, sUpdates, zUpdates, new Set(), true, appliedPaths, updatesByParent);
               prev = applyBatchUpdates(prev, sUpdates, zUpdates, getAffectedPaths([sUpdates, zUpdates]), true, appliedPaths, updatesByParent);
          }

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

  const handleGoUp = () => {
    if (!data || !currentViewPath || normalizePathForMatch(currentViewPath) === normalizePathForMatch(data.path)) return;

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

  const handleGoRoot = () => {
    if (!data) return;
    setCurrentViewPath(data.path);
  };

  // --- Derived Data ---

  const sunburstData = useMemo(() => {
    if (!data) return null;
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode) return null;
    return processForSunburst(targetNode, 7, 0, 0, t);
  }, [data, currentViewPath, t]);

  const treemapData = useMemo(() => {
    if (!data) return null;
    const targetNode = currentViewPath ? findNodeByPath(data, currentViewPath) : data;
    if (!targetNode) return null;
    return processForTreemap(targetNode, 7);
  }, [data, currentViewPath]);

  const eChartsData = view === 'treemap' ? treemapData : sunburstData;

  const [debouncedEChartsData, setDebouncedEChartsData] = useState(eChartsData);
  const lastUpdateTime = useRef(Date.now());

  useEffect(() => {
    // During scan, update at most once every 2 seconds to avoid chart flashing
    // Otherwise, update with a small delay
    const throttleMs = isScanning ? 2000 : (view === 'treemap' ? 100 : 200);
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTime.current;

    if (timeSinceLastUpdate >= throttleMs) {
      setDebouncedEChartsData(eChartsData);
      lastUpdateTime.current = now;
    } else {
      const timer = setTimeout(() => {
        setDebouncedEChartsData(eChartsData);
        lastUpdateTime.current = Date.now();
      }, throttleMs - timeSinceLastUpdate);
      return () => clearTimeout(timer);
    }
  }, [eChartsData, view, isScanning]);

  const categoryData = useMemo(() => {
    if (view !== 'chart') return [];
    if (!data) return [];

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
      
      const parts = node.name.split('.');
      let ext = parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
      if (!ext) ext = 'no_ext'; 
      
      extensionMap.set(ext, (extensionMap.get(ext) || 0) + size);
    };

    accumulate(targetNode);

    const sortedExtensions = Array.from(extensionMap.entries())
      .map(([ext, size]) => ({
        name: ext === 'no_ext' ? '(No Ext)' : `.${ext.toUpperCase()}`,
        value: size,
        formattedSize: formatSize(size),
        path: '',
        isDir: false,
      }))
      .sort((a, b) => b.value - a.value);

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

  const stopScan = useCallback(async () => {
    if (!isTauri()) return;

    const confirmed = await confirm(t('confirmStopScan'), { title: t('stopScan'), kind: 'warning' });
    if (!confirmed) return;

    try {
        await invoke("cancel_scan");
        setScanProgress(null);
        setIsBackgroundScanning(false);
        setLoading(false);
    } catch (err) {
        console.error("Failed to cancel scan:", err);
    }
  }, [t]);

  return {
      data, setData,
      loading, setLoading,
      scanStartTime,
      diskStats, setDiskStats,
    scanProgress, setScanProgress,
    error, setError,
    isScanning,
    view, setView,
    isSearchOpen, setIsSearchOpen,
    isToolsMenuOpen, setIsToolsMenuOpen,
    expandedPaths, setExpandedPaths,
    loadingPaths, setLoadingPaths,
    isDragActive, setIsDragActive,
    currentViewPath, setCurrentViewPath,
    languageMode, setLanguageMode,
    systemLocale, setSystemLocale,
    locale,
    isSponsorModalOpen, setIsSponsorModalOpen,
    isRateModalOpen, setIsRateModalOpen,
    isAboutModalOpen, setIsAboutModalOpen,
    sizeMetric, setSizeMetric,
    isReceivingUpdates, setIsReceivingUpdates,
    contextMenu, setContextMenu,
    isRTL, t, numberLocale,
    fileListRef,
    
    // Actions
    analyzeFullDisk,
    stopScan,
    analyzePath,
    handleSelectFolder,
    handleRefresh,
    toggleExpand,
    handleContextMenu,
    handleGlobalContextMenu,
    handleOpenInExplorer,
    handleChartDrillDown,
    handleGoUp,
    handleGoRoot,

    // Derived
    eChartsData,
    debouncedEChartsData,
    categoryData,
    sunburstData,
    treemapData,
    availableDisks,
    physicalDisks,
    handleSelectDrive,
    refreshDrives,
  };
}
