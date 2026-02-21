import React, { useMemo, useState } from 'react';
import { 
  Video, 
  Image as ImageIcon, 
  Music, 
  FileText, 
  Archive, 
  AppWindow, 
  Cpu, 
  FileQuestion, 
  ChevronRight, 
  ArrowLeft,
  File,
  Code,
  Type,
  BookOpen,
  ArrowUp,
  ArrowDown,
  Database,
  Hammer
} from 'lucide-react';
import { FileNode } from '../types';
import { formatSize, cn } from '../utils';
import { aggregateCategoryStats, FileCategory } from '../utils/fileTypeStats';

interface FileTypeViewProps {
  data: FileNode;
  t: (key: string, params?: any) => string;
  onContextMenu?: (e: React.MouseEvent, path: string) => void;
}

const CATEGORY_CONFIG: Record<FileCategory, { icon: React.ElementType, color: string, labelKey: string }> = {
  video: { icon: Video, color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20', labelKey: 'categoryVideo' },
  image: { icon: ImageIcon, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20', labelKey: 'categoryImage' },
  audio: { icon: Music, color: 'text-pink-500 bg-pink-50 dark:bg-pink-900/20', labelKey: 'categoryAudio' },
  document: { icon: FileText, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20', labelKey: 'categoryDocument' },
  archive: { icon: Archive, color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20', labelKey: 'categoryArchive' },
  software: { icon: AppWindow, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-900/20', labelKey: 'categorySoftware' },
  system: { icon: Cpu, color: 'text-slate-500 bg-slate-50 dark:bg-slate-900/20', labelKey: 'categorySystem' },
  code: { icon: Code, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20', labelKey: 'categoryCode' },
  database: { icon: Database, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20', labelKey: 'categoryDatabase' },
  developer: { icon: Hammer, color: 'text-rose-500 bg-rose-50 dark:bg-rose-900/20', labelKey: 'categoryDeveloper' },
  font: { icon: Type, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20', labelKey: 'categoryFont' },
  book: { icon: BookOpen, color: 'text-teal-600 bg-teal-50 dark:bg-teal-900/20', labelKey: 'categoryBook' },
  other: { icon: FileQuestion, color: 'text-gray-500 bg-gray-50 dark:bg-gray-900/20', labelKey: 'categoryOther' },
};

type SortField = 'name' | 'size' | 'date';
type SortDirection = 'asc' | 'desc';

/**
 * 文件类型统计视图组件
 * File Type Statistics View Component
 */
export const FileTypeView: React.FC<FileTypeViewProps> = ({ data, t, onContextMenu }) => {
  const [selectedCategory, setSelectedCategory] = useState<FileCategory | null>(null);
  const [sortField, setSortField] = useState<SortField>('size');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const stats = useMemo(() => {
    return aggregateCategoryStats(data);
  }, [data]);

  const totalSize = useMemo(() => {
    return Object.values(stats).reduce((acc, curr) => acc + curr.size, 0);
  }, [stats]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (selectedCategory) {
    const categoryData = stats[selectedCategory];
    const Config = CATEGORY_CONFIG[selectedCategory];
    const Icon = Config.icon;

    // Sort files
    const sortedFiles = [...categoryData.files].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'date':
          comparison = (a.last_modified || 0) - (b.last_modified || 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    const SortIcon = ({ field }: { field: SortField }) => {
      if (sortField !== field) return null;
      return sortDirection === 'asc' ? <ArrowUp size={14} className="ml-1 inline" /> : <ArrowDown size={14} className="ml-1 inline" />;
    };

    return (
      <div className="h-full flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="flex items-center mb-1 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button 
              onClick={() => setSelectedCategory(null)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors shrink-0"
            >
              <ArrowLeft size={16} />
            </button>
            <div className={cn("p-1 rounded-lg shrink-0", Config.color)}>
              <Icon size={18} />
            </div>
            <h2 className="text-base font-bold truncate">{t(Config.labelKey)}</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 ml-2">
            {formatSize(categoryData.size)} · {t('itemsCount', { count: categoryData.count.toLocaleString() })}
          </p>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="overflow-auto overflow-x-hidden flex-1">
            <table className="w-full text-left text-sm table-fixed">
              <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0 z-10">
                <tr>
                  <th 
                    className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none w-auto"
                    onClick={() => handleSort('name')}
                  >
                    {t('sortByName')} <SortIcon field="name" />
                  </th>
                  <th 
                    className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none w-36"
                    onClick={() => handleSort('date')}
                  >
                    {t('sortByDate')} <SortIcon field="date" />
                  </th>
                  <th 
                    className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none w-24"
                    onClick={() => handleSort('size')}
                  >
                    {t('sortBySize')} <SortIcon field="size" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sortedFiles.slice(0, 200).map((file, idx) => (
                  <tr 
                    key={`${file.path}-${idx}`} 
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-default"
                    onContextMenu={(e) => onContextMenu && onContextMenu(e, file.path)}
                  >
                    <td className="px-4 py-2 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <File size={16} className="text-gray-400 shrink-0" />
                        <div className="flex flex-col min-w-0 overflow-hidden">
                          <span className="truncate font-medium text-gray-700 dark:text-gray-200" title={file.name}>{file.name}</span>
                          <span className="truncate text-xs text-gray-400" title={file.path}>{file.path}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {file.last_modified ? new Date(file.last_modified > 10000000000 ? file.last_modified : file.last_modified * 1000).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {formatSize(file.size)}
                    </td>
                  </tr>
                ))}
                {categoryData.files.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      {t('noData')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Calculate percentages for bar chart
  const sortedCategories = (Object.keys(stats) as FileCategory[])
    .sort((a, b) => stats[b].size - stats[a].size);

  return (
    <div className="h-full overflow-auto p-1">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedCategories.map(cat => {
          const stat = stats[cat];
          const Config = CATEGORY_CONFIG[cat];
          const Icon = Config.icon;
          const percent = totalSize > 0 ? (stat.size / totalSize) * 100 : 0;

          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className="flex flex-col p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all text-left group"
            >
              <div className="flex items-center justify-between w-full mb-3">
                <div className={cn("p-3 rounded-xl transition-colors group-hover:scale-110 duration-200", Config.color)}>
                  <Icon size={24} />
                </div>
                <div className="flex items-center text-gray-400 group-hover:text-blue-500 transition-colors">
                  <ChevronRight size={20} />
                </div>
              </div>
              
              <div className="w-full">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1">
                  {t(Config.labelKey)}
                </h3>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">
                    {formatSize(stat.size)}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t('itemsCount', { count: stat.count.toLocaleString() })}
                  </span>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
                  <div 
                    className={cn("h-full rounded-full transition-all duration-500 ease-out", Config.color.split(' ')[0])} // use text color class for bar
                    style={{ width: `${Math.max(percent, 1)}%`, backgroundColor: 'currentColor' }}
                  />
                </div>
                <div className="mt-1 text-xs text-gray-400 text-right">
                  {percent.toFixed(1)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
