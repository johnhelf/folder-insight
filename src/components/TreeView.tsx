import React, { useMemo, CSSProperties } from 'react';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { 
  ChevronRight, 
  ChevronDown, 
  ChevronLeft,
  Folder, 
  File, 
  Loader2, 
  ShieldAlert
} from "lucide-react";
import { formatSize, cn } from "../utils";
import { FileNode, DiskStats } from "../types";



interface TreeViewProps {
  data: FileNode;
  diskStats: DiskStats | null;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
  isRTL?: boolean;
}

interface FlatNode {
  node: FileNode;
  depth: number;
}

interface RowData {
  flatData: FlatNode[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
  isRTL?: boolean;
}

const flattenTree = (
  node: FileNode, 
  expandedPaths: Set<string>, 
  result: FlatNode[] = [], 
  depth: number = 0
): FlatNode[] => {
  result.push({ node, depth });
  if (node.is_dir && expandedPaths.has(node.path) && node.children) {
    for (const child of node.children) {
      flattenTree(child, expandedPaths, result, depth + 1);
    }
  }
  return result;
};

interface RowProps extends RowData {
  index: number;
  style: CSSProperties;
}

const Row = ({ index, style, flatData, expandedPaths, loadingPaths, onToggleExpand, onContextMenu, t, isRTL }: RowProps) => {
  const { node, depth } = flatData[index];
  const isExpanded = expandedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.path);
  const indent = depth * 1.5;

  return (
    <div style={style} className={cn("flex items-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm border-b border-gray-100 dark:border-gray-800/50 select-none", isRTL && "flex-row-reverse")}>
      {/* Name Column - Flex 1 */}
      <div 
        className={cn("flex-1 flex items-center min-w-0 pr-4 h-full cursor-pointer", isRTL && "flex-row-reverse pl-4 pr-0")}
        style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: `${indent + 0.5}rem` }}
        onClick={() => node.is_dir && !isLoading && onToggleExpand(node.path)}
        onContextMenu={(e) => onContextMenu(e, node.path)}
      >
        <span className={cn("text-gray-500 shrink-0 flex items-center justify-center w-4", isRTL ? "ml-1" : "mr-1")}>
          {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
          ) : node.is_dir ? (
            isExpanded ? <ChevronDown size={16} /> : (isRTL ? <ChevronLeft size={16} /> : <ChevronRight size={16} />)
          ) : (
            <span className="w-4" />
          )}
        </span>
        <span className={cn("shrink-0 text-blue-500 dark:text-blue-400", isRTL ? "ml-2" : "mr-2")}>
          {node.is_dir ? (
            <Folder size={16} className="fill-blue-500/20" />
          ) : (
            <File size={16} className="text-gray-400" />
          )}
        </span>
        <span className="truncate font-medium text-gray-700 dark:text-gray-200">
          {node.name}
        </span>
        {node.is_restricted && (
            <span className={cn("inline-flex items-center gap-1 text-[10px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-800/50", isRTL ? "mr-2" : "ml-2")}>
              <ShieldAlert size={10} />
              {t('restricted')}
            </span>
        )}
      </div>

      {/* Size Column - Fixed Width */}
      <div className={cn("w-24 px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-gray-100 dark:border-gray-800 h-full flex items-center shrink-0", isRTL ? "text-left justify-start border-r" : "text-right justify-end border-l")}>
        {formatSize(node.size || 0)}
      </div>

      {/* Allocated Size Column - Fixed Width */}
      <div className={cn("w-24 px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-gray-100 dark:border-gray-800 h-full flex items-center shrink-0", isRTL ? "text-left justify-start border-r" : "text-right justify-end border-l")}>
        {formatSize(node.allocated_size || 0)}
      </div>
      
      {/* File Count Column - Fixed Width */}
      <div className={cn("w-20 px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-gray-100 dark:border-gray-800 h-full flex items-center shrink-0", isRTL ? "text-left justify-start border-r" : "text-right justify-end border-l")}>
        {node.is_dir ? node.file_count.toLocaleString() : '-'}
      </div>

      {/* Modified Column - Fixed Width */}
      <div className={cn("w-36 px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-gray-100 dark:border-gray-800 h-full flex items-center shrink-0", isRTL ? "text-left justify-start border-r" : "text-right justify-end border-l")}>
         {node.modified ? new Date(node.modified * 1000).toLocaleString() : '-'}
      </div>
    </div>
  );
};

export const TreeView: React.FC<TreeViewProps> = ({ 
  data, 
  diskStats,
  expandedPaths, 
  loadingPaths, 
  onToggleExpand, 
  onContextMenu, 
  t,
  isRTL = false
}) => {
  const flatData = useMemo(() => {
    return flattenTree(data, expandedPaths);
  }, [data, expandedPaths]);

  const itemData = useMemo(() => ({
    flatData,
    expandedPaths,
    loadingPaths,
    onToggleExpand,
    onContextMenu,
    t,
    isRTL
  }), [flatData, expandedPaths, loadingPaths, onToggleExpand, onContextMenu, t, isRTL]);

  return (
    <div className={cn("h-full flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800", isRTL && "border-r-0 border-l")}>
      {/* Header Area */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className={cn("p-3 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center", isRTL && "flex-row-reverse")}>
            <h2 className={cn("font-semibold text-sm flex items-center gap-2 text-gray-800 dark:text-gray-100", isRTL && "flex-row-reverse")}>
              <Folder className="text-blue-500" size={16} />
              {t('treeView')}
            </h2>
            
            <div className={cn("flex items-center gap-4 text-xs", isRTL && "flex-row-reverse")}>
              {diskStats && (
                <div className={cn("flex items-center gap-2 text-gray-500 dark:text-gray-400 bg-gray-200/50 dark:bg-gray-800/50 px-2 py-1 rounded", isRTL && "flex-row-reverse")}>
                  <span className="font-medium">{diskStats.name || 'Disk'} ({diskStats.mount_point}):</span>
                  <div className="w-20 h-2 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${(diskStats.used / diskStats.total) * 100}%` }}
                    />
                  </div>
                  <span>
                    {formatSize(diskStats.used)} / {formatSize(diskStats.total)}
                  </span>
                </div>
              )}
              
              <div className={cn("text-gray-500", isRTL && "flex flex-row-reverse gap-1")}>
                {t('totalSize')}: <span className="font-mono text-gray-700 dark:text-gray-300 font-medium">{formatSize(data.size || 0)}</span>
              </div>
            </div>
        </div>
        
        {/* Column Headers */}
        <div className={cn("flex items-center text-xs font-semibold text-gray-500 dark:text-gray-400 h-8 bg-gray-100/50 dark:bg-gray-800/50", isRTL && "flex-row-reverse")}>
            <div className={cn("flex-1 px-4", isRTL && "text-right")}>{t('name')}</div>
            <div className={cn("w-24 px-2 border-gray-200 dark:border-gray-700", isRTL ? "text-left border-r" : "text-right border-l")}>{t('size')}</div>
            <div className={cn("w-24 px-2 border-gray-200 dark:border-gray-700", isRTL ? "text-left border-r" : "text-right border-l")}>{t('allocatedSize')}</div>
            <div className={cn("w-20 px-2 border-gray-200 dark:border-gray-700", isRTL ? "text-left border-r" : "text-right border-l")}>{t('fileCount')}</div>
            <div className={cn("w-36 px-2 border-gray-200 dark:border-gray-700", isRTL ? "text-left border-r" : "text-right border-l")}>{t('lastModified')}</div>
            <div className="w-[17px]"></div> {/* Scrollbar spacer */}
        </div>
      </div>
      
      {/* Virtualized List */}
      <div className="flex-1">
        <AutoSizer
          renderProp={({ height, width }: { height: number | undefined; width: number | undefined }) => (
            <List<RowData>
              style={{ height: height || 0, width: width || 0 }}
              rowCount={flatData.length}
              rowHeight={36}
              rowProps={itemData}
              rowComponent={Row}
            />
          )}
        />
      </div>
    </div>
  );
};
