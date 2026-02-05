import React from 'react';
import { AnimatePresence, motion } from "framer-motion";
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  File, 
  Loader2,
  ShieldAlert
} from "lucide-react";
import { formatSize, cn } from "../utils";
import { FileNode } from "../types";

interface TreeViewProps {
  data: FileNode;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
  numberLocale: string;
}

export const TreeView: React.FC<TreeViewProps> = ({ 
  data, 
  expandedPaths, 
  loadingPaths, 
  onToggleExpand, 
  onContextMenu, 
  t, 
  numberLocale 
}) => {
  const renderTree = (node: FileNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isLoading = loadingPaths.has(node.path);

    return (
      <div key={node.path} className="select-none">
        <div 
          className={cn(
            "flex items-center py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer transition-colors group",
            depth === 0 && "font-bold text-lg"
          )}
          style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
          onClick={() => node.is_dir && !isLoading && onToggleExpand(node.path)}
          onContextMenu={(e) => onContextMenu(e, node.path)}
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
          <span className="flex-1 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {node.name}
            {node.is_restricted && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-800/50">
                <ShieldAlert size={10} />
                {t('restricted')}
              </span>
            )}
          </span>
          <div className="flex items-center gap-4 text-xs text-gray-400 font-mono group-hover:text-gray-600 dark:group-hover:text-gray-300">
              <span className="w-20 text-right truncate hidden sm:block">
                {node.is_dir ? t('itemsCount', { count: node.file_count.toLocaleString(numberLocale) }) : '-'}
              </span>
              <span className="w-24 text-right truncate">
                {node.size === null ? t('calculating') : formatSize(node.size)}
              </span>
              <span className="w-24 text-right truncate hidden md:block">
                {node.allocated_size === null ? t('calculating') : formatSize(node.allocated_size)}
              </span>
            </div>
        </div>
        <AnimatePresence initial={false}>
          {node.is_dir && isExpanded && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              {node.children.map(child => renderTree(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-800 text-xs font-medium text-gray-500 bg-gray-50/50 dark:bg-gray-800/50 select-none shrink-0">
        <span className="flex-1 ml-8">{t('name')}</span>
        <div className="flex items-center gap-4">
          <span className="w-20 text-right hidden sm:block">{t('fileCount')}</span>
          <span className="w-24 text-right">{t('size')}</span>
          <span className="w-24 text-right hidden md:block">{t('allocatedSize')}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {renderTree(data)}
      </div>
    </div>
  );
};
