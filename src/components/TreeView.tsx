import React, { useMemo, CSSProperties } from 'react';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  File, 
  Loader2, 
  ShieldAlert
} from "lucide-react";
import { formatSize } from "../utils";
import { FileNode } from "../types";



interface TreeViewProps {
  data: FileNode;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
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

const Row = ({ index, style, flatData, expandedPaths, loadingPaths, onToggleExpand, onContextMenu, t }: RowProps) => {
  const { node, depth } = flatData[index];
  const isExpanded = expandedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.path);
  const indent = depth * 1.5;

  return (
    <div style={style} className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm border-b border-gray-100 dark:border-gray-800/50 select-none">
      {/* Name Column - Flex 1 */}
      <div 
        className="flex-1 flex items-center min-w-0 pr-4 h-full cursor-pointer"
        style={{ paddingLeft: `${indent + 0.5}rem` }}
        onClick={() => node.is_dir && !isLoading && onToggleExpand(node.path)}
        onContextMenu={(e) => onContextMenu(e, node.path)}
      >
        <span className="mr-1 text-gray-500 shrink-0 flex items-center justify-center w-4">
          {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
          ) : node.is_dir ? (
            isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          ) : (
            <span className="w-4" />
          )}
        </span>
        <span className="mr-2 shrink-0 text-blue-500 dark:text-blue-400">
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
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-800/50">
              <ShieldAlert size={10} />
              {t('restricted')}
            </span>
        )}
      </div>

      {/* Size Column - Fixed Width */}
      <div className="w-24 text-right px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-l border-gray-100 dark:border-gray-800 h-full flex items-center justify-end shrink-0">
        {formatSize(node.size || 0)}
      </div>

      {/* Allocated Size Column - Fixed Width */}
      <div className="w-24 text-right px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-l border-gray-100 dark:border-gray-800 h-full flex items-center justify-end shrink-0">
        {formatSize(node.allocated_size || 0)}
      </div>
      
      {/* File Count Column - Fixed Width */}
      <div className="w-20 text-right px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-l border-gray-100 dark:border-gray-800 h-full flex items-center justify-end shrink-0">
        {node.is_dir ? node.file_count.toLocaleString() : '-'}
      </div>

      {/* Modified Column - Fixed Width */}
      <div className="w-36 text-right px-2 text-gray-600 dark:text-gray-400 font-mono text-xs border-l border-gray-100 dark:border-gray-800 h-full flex items-center justify-end shrink-0">
         {node.modified ? new Date(node.modified * 1000).toLocaleString() : '-'}
      </div>
    </div>
  );
};

export const TreeView: React.FC<TreeViewProps> = ({ 
  data, 
  expandedPaths, 
  loadingPaths, 
  onToggleExpand, 
  onContextMenu, 
  t
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
    t
  }), [flatData, expandedPaths, loadingPaths, onToggleExpand, onContextMenu, t]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
      {/* Header Area */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
            <h2 className="font-semibold text-sm flex items-center gap-2 text-gray-800 dark:text-gray-100">
            <Folder className="text-blue-500" size={16} />
            {t('treeView')}
            </h2>
            <div className="text-xs text-gray-500">
            {t('totalSize')}: <span className="font-mono text-gray-700 dark:text-gray-300 font-medium">{formatSize(data.size || 0)}</span>
            </div>
        </div>
        
        {/* Column Headers */}
        <div className="flex items-center text-xs font-semibold text-gray-500 dark:text-gray-400 h-8 bg-gray-100/50 dark:bg-gray-800/50">
            <div className="flex-1 px-4">{t('name')}</div>
            <div className="w-24 text-right px-2 border-l border-gray-200 dark:border-gray-700">{t('size')}</div>
            <div className="w-24 text-right px-2 border-l border-gray-200 dark:border-gray-700">{t('allocatedSize')}</div>
            <div className="w-20 text-right px-2 border-l border-gray-200 dark:border-gray-700">{t('fileCount')}</div>
            <div className="w-36 text-right px-2 border-l border-gray-200 dark:border-gray-700">{t('lastModified')}</div>
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
