import { useEffect } from "react";
import { cn } from "./utils";
import { SponsorModal } from "./components/SponsorModal";
import { RateModal } from "./components/RateModal";
import { useAppLogic } from "./hooks/useAppLogic";
import { AppHeader } from "./components/AppHeader";
import { StatsGrid } from "./components/StatsGrid";
import { FileTreeArea } from "./components/FileTreeArea";
import { DragOverlay } from "./components/DragOverlay";
import { ContextMenu } from "./components/ContextMenu";
import { EmptyState } from "./components/EmptyState";
import { ScanProgress } from "./components/ScanProgress";
import { AboutModal } from './components/AboutModal';

/**
 * 应用主组件：展示目录树与统计信息，并监听后端实时大小更新。
 * Main app component: renders directory tree and statistics; listens to backend realtime size updates.
 */
function App() {
    const {
    data,
    loading,
    scanStartTime,
    error,
    scanProgress,
    diskStats,
    availableDisks,
    physicalDisks,
    view,
    setView,
    expandedPaths,
    loadingPaths,
    isDragActive,
    contextMenu,
    isToolsMenuOpen,
    setIsToolsMenuOpen,
    languageMode,
    setLanguageMode,
    systemLocale,
    isSponsorModalOpen,
    setIsSponsorModalOpen,
    isRateModalOpen,
    setIsRateModalOpen,
    isAboutModalOpen,
    setIsAboutModalOpen,
    sizeMetric,
    setSizeMetric,
    locale,
    currentViewPath,
    isReceivingUpdates,
    isScanning,
    fileListRef,
    analyzeFullDisk,
    stopScan,
    handleSelectDrive,
    handleSelectFolder,
    handleRefresh,
    toggleExpand,
    handleContextMenu,
    handleGlobalContextMenu,
    handleOpenInExplorer,
    handleChartDrillDown,
    handleGoUp,
    handleGoRoot,
    debouncedEChartsData,
    categoryData,
    isRTL,
    t,
    numberLocale,
  } = useAppLogic();

  useEffect(() => {
    // 生产环境下禁用开发者工具快捷键
    // Disable developer tools shortcuts in production
    const handleDevToolsShortcuts = (e: KeyboardEvent) => {
      if (import.meta.env.PROD) {
        // F12
        if (e.key === 'F12') {
          e.preventDefault();
        }
        // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (Windows/Linux)
        // Cmd+Option+I / Cmd+Option+J / Cmd+Option+C (Mac)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (['I', 'J', 'C'].includes(e.key.toUpperCase()))) {
          e.preventDefault();
        }
        // Ctrl+U (View Source)
        if ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'U') {
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleDevToolsShortcuts);
    
    // 生产环境下禁用右键菜单 (如果需要完全锁定)
    // Disable context menu in production (if full lock is needed)
    const handleContextMenuGlobal = (e: MouseEvent) => {
      if (import.meta.env.PROD) {
        // 允许在某些特定元素上显示自定义右键菜单，否则禁用默认右键
        // Allow custom context menu, but prevent default system menu
        e.preventDefault();
      }
    };

    // 防止全局拖拽导致浏览器默认打开文件/文件夹
    // Prevent default drag and drop behavior to avoid browser opening files
    const preventDefaultDrag = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dragover' && e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    if (import.meta.env.PROD) {
      window.addEventListener('contextmenu', handleContextMenuGlobal);
    }

    window.addEventListener('dragover', preventDefaultDrag);
    window.addEventListener('drop', preventDefaultDrag);

    return () => {
      window.removeEventListener('keydown', handleDevToolsShortcuts);
      window.removeEventListener('contextmenu', handleContextMenuGlobal);
      window.removeEventListener('dragover', preventDefaultDrag);
      window.removeEventListener('drop', preventDefaultDrag);
    };
  }, []);

  const getTotalSize = () => {
    // 优先使用 scanProgress 里的 total_size (如果有)
    if (scanProgress?.total_size && scanProgress.total_size > 0) {
      return scanProgress.total_size;
    }

    const currentRootPath = data?.path;
    if (!currentRootPath) return null;

    if (currentRootPath === "ALL_DISKS" || currentRootPath.startsWith("PHYSICAL_DISK:")) {
        return data?.size || null;
    }
    // If scanning a specific drive's root, we can use diskStats.used
    if (diskStats) {
        // Normalize paths for comparison
        const normRoot = currentRootPath.replace(/\\/g, '/').toLowerCase();
        const normMount = diskStats.mount_point.replace(/\\/g, '/').toLowerCase();
        if (normRoot === normMount || normRoot === normMount + '/') {
            return diskStats.used;
        }
    }
    return null; // For normal folders, we don't know the total size in advance
  };

  return (
    <div
      className={cn(
        "h-screen flex flex-col bg-[#f8f9fa] dark:bg-[#0f1117] text-gray-900 dark:text-gray-100 font-sans overflow-hidden relative",
        isRTL && "rtl"
      )}
      dir={isRTL ? "rtl" : "ltr"}
      onContextMenu={handleGlobalContextMenu}
    >
      {isDragActive && <DragOverlay t={t} />}

      <AppHeader
        t={t}
        loading={isScanning}
        data={data}
        availableDisks={availableDisks}
        physicalDisks={physicalDisks}
        analyzeFullDisk={analyzeFullDisk}
        stopScan={stopScan}
        handleSelectDrive={handleSelectDrive}
        handleRefresh={handleRefresh}
        handleSelectFolder={handleSelectFolder}
        view={view}
        setView={setView}
        isToolsMenuOpen={isToolsMenuOpen}
        setIsToolsMenuOpen={setIsToolsMenuOpen}
        languageMode={languageMode}
        setLanguageMode={setLanguageMode}
        systemLocale={systemLocale}
        setIsSponsorModalOpen={setIsSponsorModalOpen}
        setIsAboutModalOpen={setIsAboutModalOpen}
        isRTL={isRTL}
      />

      <main className="flex-1 flex flex-col w-full p-4 overflow-hidden">
        {contextMenu && contextMenu.visible && (
          <ContextMenu 
            x={contextMenu.x}
            y={contextMenu.y}
            handleOpenInExplorer={handleOpenInExplorer}
            t={t}
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 shrink-0">
            {error}
          </div>
        )}

        {!data && !loading && <EmptyState t={t} />}

        {(isScanning || scanProgress) && (
          <ScanProgress 
            t={t} 
            scanProgress={scanProgress} 
            scanStartTime={scanStartTime}
            isRTL={isRTL}
            totalSize={getTotalSize()}
          />
        )}

        {data && !loading && (
          <div className="flex flex-col h-full space-y-4">
            <StatsGrid 
              data={data}
              view={view}
              sizeMetric={sizeMetric}
              setSizeMetric={setSizeMetric}
              availableDisks={availableDisks}
              scanProgress={scanProgress}
              t={t}
              numberLocale={numberLocale}
              isReceivingUpdates={isReceivingUpdates}
              physicalDisks={physicalDisks}
            />
            
            <FileTreeArea 
              view={view}
              data={data}
              diskStats={diskStats}
              availableDisks={availableDisks}
              expandedPaths={expandedPaths}
              loadingPaths={loadingPaths}
              toggleExpand={toggleExpand}
              handleContextMenu={handleContextMenu}
              t={t}
              locale={locale}
              isRTL={isRTL}
              debouncedEChartsData={debouncedEChartsData}
              categoryData={categoryData}
              handleChartDrillDown={handleChartDrillDown}
              handleGoUp={handleGoUp}
              handleGoRoot={handleGoRoot}
              currentViewPath={currentViewPath}
              fileListRef={fileListRef}
            />
          </div>
        )}
      </main>

        {/* 赞助弹窗 / Sponsor Modal */}
      <SponsorModal 
        isOpen={isSponsorModalOpen}
        onClose={() => setIsSponsorModalOpen(false)}
        t={t}
      />
      
      {/* 关于弹窗 / About Modal */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
        t={t}
        onRateClick={() => setIsRateModalOpen(true)}
      />
      {/* 评分弹窗 / Rate Modal */}
      <RateModal 
        isOpen={isRateModalOpen}
        onClose={() => setIsRateModalOpen(false)}
        t={t}
      />
    </div>
  );
}

export default App;
