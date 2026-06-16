import React, { Suspense, lazy } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { normalizePathForMatch } from "../utils/treeUtils";
import { TreeView } from "./TreeView";
import { FileNode, DiskStats } from "../types";
import { ErrorBoundary } from "./ErrorBoundary";

const ChartView = lazy(() => import("./ChartView").then(module => ({ default: module.ChartView })));
const TreemapView = lazy(() => import("./TreemapView").then(module => ({ default: module.TreemapView })));
const FileTypeView = lazy(() => import("./FileTypeView").then(module => ({ default: module.FileTypeView })));
const DuplicatesView = lazy(() => import("./DuplicatesView").then(module => ({ default: module.DuplicatesView })));
const AIInsightsView = lazy(() => import("./AIInsightsView").then(module => ({ default: module.AIInsightsView })));

interface FileTreeAreaProps {
  view: string;
  data: FileNode;
  diskStats: DiskStats | null;
  availableDisks: DiskStats[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  toggleExpand: (path: string) => void;
  handleContextMenu: (e: React.MouseEvent | MouseEvent, path: string) => void;
  t: (key: string) => string;
  locale: string;
  isRTL: boolean;
  debouncedEChartsData: any;
  categoryData: any;
  handleChartDrillDown: (path: string) => void;
  handleGoUp: () => void;
  handleGoRoot: () => void;
  currentViewPath: string | null;
  fileListRef: React.RefObject<HTMLDivElement | null>;
}

export function FileTreeArea({
  view,
  data,
  diskStats,
  availableDisks,
  expandedPaths,
  loadingPaths,
  toggleExpand,
  handleContextMenu,
  t,
  locale,
  isRTL,
  debouncedEChartsData,
  categoryData,
  handleChartDrillDown,
  handleGoUp,
  handleGoRoot,
  currentViewPath,
  fileListRef,
}: FileTreeAreaProps) {
  
  return (
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
              availableDisks={availableDisks}
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
            <ErrorBoundary>
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
            </ErrorBoundary>
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
            <ErrorBoundary>
              <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
                <FileTypeView 
                  data={data}
                  t={t}
                  isRTL={isRTL}
                  onContextMenu={handleContextMenu}
                />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        ) : view === 'duplicates' ? (
          <motion.div
            key="duplicates"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden"
          >
            <ErrorBoundary>
              <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
                <DuplicatesView 
                  t={t}
                  isRTL={isRTL}
                  targetDirs={(() => {
                    const p = currentViewPath || data.path;
                    return p === "ALL_DISKS" ? (data.children?.map(c => c.path) || []) : [p];
                  })()}
                  onOpenInExplorer={(path) => {
                      invoke("open_in_explorer", { path });
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        ) : view === 'aiInsights' ? (
          <motion.div
            key="aiInsights"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden"
          >
            <ErrorBoundary>
              <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}>
                <AIInsightsView 
                  rootPaths={(() => {
                    const p = currentViewPath || data.path;
                    return p === "ALL_DISKS" ? (data.children?.map(c => c.path) || []) : [p];
                  })()}
                  t={t}
                  locale={locale}
                  onOpenExplorer={(path) => {
                      invoke("open_in_explorer", { path });
                  }}
                />
              </Suspense>
            </ErrorBoundary>
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
            <ErrorBoundary>
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
            </ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
