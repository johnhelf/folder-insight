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
  Hammer,
  Clock,
  Calendar,
  CalendarDays,
  History,
  Hourglass
} from 'lucide-react';
import { FileNode } from '../types';
import { formatSize, cn } from '../utils';
import { aggregateCategoryStats, aggregateTemporalStats, FileCategory, TimeRange } from '../utils/fileTypeStats';

interface FileTypeViewProps {
  data: FileNode;
  t: (key: string, params?: any) => string;
  isRTL?: boolean;
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

const TIME_CONFIG: Record<TimeRange, { icon: React.ElementType, color: string, labelKey: string }> = {
  '24h': { icon: Clock, color: 'text-green-500 bg-green-50 dark:bg-green-900/20', labelKey: 'time24h' },
  '7d': { icon: Calendar, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20', labelKey: 'time7d' },
  '30d': { icon: CalendarDays, color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20', labelKey: 'time30d' },
  '1y': { icon: History, color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20', labelKey: 'time1y' },
  'older': { icon: Hourglass, color: 'text-gray-500 bg-gray-50 dark:bg-gray-900/20', labelKey: 'timeOlder' },
};

type SortField = 'name' | 'size' | 'date';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'type' | 'time';

/**
 * 文件类型统计视图组件
 * File Type Statistics View Component
 */
export const FileTypeView: React.FC<FileTypeViewProps> = ({ data, t, isRTL = false, onContextMenu }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('type');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('size');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const stats = useMemo(() => {
    return aggregateCategoryStats(data);
  }, [data]);

  const timeStats = useMemo(() => {
    return aggregateTemporalStats(data);
  }, [data]);

  const currentStats = viewMode === 'type' ? stats : timeStats;
  // @ts-ignore - Dynamic access to config
  const currentConfig = viewMode === 'type' ? CATEGORY_CONFIG : TIME_CONFIG;

  const totalSize = useMemo(() => {
    return Object.values(currentStats).reduce((acc: any, curr: any) => acc + curr.size, 0);
  }, [currentStats]);

  // @ts-ignore
  const groupData = selectedGroup ? currentStats[selectedGroup] : null;
  // @ts-ignore
  const Config = selectedGroup ? currentConfig[selectedGroup] : null;

  // Sort files
  const sortedFiles = useMemo(() => {
    if (!groupData) return [];
    return [...(groupData.files || [])].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = (a?.name || '').localeCompare(b?.name || '');
          break;
        case 'size':
          comparison = (a?.size || 0) - (b?.size || 0);
          break;
        case 'date':
          comparison = (a?.last_modified || 0) - (b?.last_modified || 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [groupData, sortField, sortDirection]);

  // Calculate percentages for bar chart
  const sortedKeys = useMemo(() => {
    const keys = Object.keys(currentStats);
    if (viewMode === 'time') {
      const timeOrder = ['24h', '7d', '30d', '1y', 'older'];
      return keys.sort((a, b) => timeOrder.indexOf(a) - timeOrder.indexOf(b));
    }
    return keys.sort((a, b) => {
      // @ts-ignore
      return currentStats[b].size - currentStats[a].size;
    });
  }, [currentStats, viewMode]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (selectedGroup) {
    if (!groupData || !Config) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-red-500">{t('errorLoadingDetails') || "Error loading details"}</p>
          <button onClick={() => setSelectedGroup(null)} className="ml-4 text-blue-500 underline">{t('back') || "Back"}</button>
        </div>
      );
    }

    const Icon = Config.icon || FileQuestion;

    const renderSortIcon = (field: SortField) => {
      if (sortField !== field) return null;
      return sortDirection === 'asc' ? <ArrowUp size={14} className={cn(isRTL ? "mr-1" : "ml-1", "inline")} /> : <ArrowDown size={14} className={cn(isRTL ? "mr-1" : "ml-1", "inline")} />;
    };

    return (
      <div 
        className={cn("h-full flex flex-col animate-in fade-in slide-in-from-right-4 duration-300", isRTL && "text-right")}
        dir={isRTL ? "rtl" : "ltr"}
      >
        <div className={cn("flex items-center mb-1 shrink-0 gap-2", isRTL && "flex-row-reverse")}>
          <div className={cn("flex items-center gap-2 min-w-0", isRTL && "flex-row-reverse")}>
            <button 
              onClick={() => setSelectedGroup(null)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors shrink-0"
            >
              {isRTL ? <ChevronRight size={16} /> : <ArrowLeft size={16} />}
            </button>
            <div className={cn("p-1 rounded-lg shrink-0", Config?.color || 'bg-gray-100')}>
              <Icon size={18} />
            </div>
            <h2 className="text-base font-bold truncate">{Config?.labelKey ? t(Config.labelKey) : 'Unknown'}</h2>
          </div>
          <p className={cn("text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0", isRTL ? "mr-2" : "ml-2")}>
            {formatSize(groupData?.size || 0)} · {t('itemsCount', { count: (groupData?.count || 0).toLocaleString() })}
          </p>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="overflow-auto overflow-x-hidden flex-1">
            <table className={cn("w-full text-sm table-fixed", isRTL ? "text-right" : "text-left")}>
              <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0 z-10">
                <tr>
                  <th 
                    className={cn("px-4 py-2 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none w-auto", isRTL ? "text-right" : "text-left")}
                    onClick={() => handleSort('name')}
                  >
                    {t('sortByName')} {renderSortIcon('name')}
                  </th>
                  <th 
                    className={cn("px-4 py-2 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none w-48", isRTL ? "text-left" : "text-right")}
                    onClick={() => handleSort('date')}
                  >
                    {t('dateModified')} {renderSortIcon('date')}
                  </th>
                  <th 
                    className={cn("px-4 py-2 font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none w-28", isRTL ? "text-left" : "text-right")}
                    onClick={() => handleSort('size')}
                  >
                    {t('sortBySize')} {renderSortIcon('size')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sortedFiles.slice(0, 200).map((file, idx) => {
                  if (!file) return null;
                  return (
                    <tr 
                      key={`${file.path}-${idx}`} 
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-default"
                      onContextMenu={(e) => onContextMenu && file.path && onContextMenu(e, file.path)}
                    >
                      <td className="px-4 py-2 overflow-hidden">
                        <div className={cn("flex items-center gap-2", isRTL && "flex-row-reverse")}>
                          <File size={16} className="text-gray-400 shrink-0" />
                          <div className={cn("flex flex-col min-w-0 overflow-hidden", isRTL && "items-end")}>
                            <span className="truncate font-medium text-gray-700 dark:text-gray-200" title={file.name || ''}>{file.name || 'Unknown'}</span>
                            <span className="truncate text-xs text-gray-400" title={file.path || ''}>{file.path || ''}</span>
                          </div>
                        </div>
                      </td>
                      <td className={cn("px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap", isRTL ? "text-left" : "text-right")}>
                        {file.last_modified ? new Date(file.last_modified > 10000000000 ? file.last_modified : file.last_modified * 1000).toLocaleString() : '-'}
                      </td>
                      <td className={cn("px-4 py-2 font-mono text-gray-600 dark:text-gray-300 whitespace-nowrap", isRTL ? "text-left" : "text-right")}>
                        {formatSize(file.size || 0)}
                      </td>
                    </tr>
                  );
                })}
                {(!groupData.files || groupData.files.length === 0) && (
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 p-2 flex justify-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => {
              setViewMode('type');
              setSelectedGroup(null);
            }}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
              viewMode === 'type' 
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" 
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            )}
          >
            {t('fileType')}
          </button>
          <button
            onClick={() => {
              setViewMode('time');
              setSelectedGroup(null);
            }}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
              viewMode === 'time' 
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" 
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            )}
          >
            {t('fileAge')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-2">
          {sortedKeys.map(key => {
            // @ts-ignore
            const stat = currentStats[key];
            // @ts-ignore
            const Config = currentConfig[key];
            const Icon = Config.icon;
            const percent = totalSize > 0 ? (stat.size / totalSize) * 100 : 0;

            return (
              <button
                key={key}
                onClick={() => setSelectedGroup(key)}
                className={cn(
                  "flex flex-col p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all group",
                  isRTL ? "text-right" : "text-left"
                )}
              >
                <div className={cn("flex items-center justify-between w-full mb-3", isRTL && "flex-row-reverse")}>
                  <div className={cn("p-3 rounded-xl transition-colors group-hover:scale-110 duration-200", Config.color)}>
                    <Icon size={24} />
                  </div>
                  <div className={cn("flex items-center text-gray-400 group-hover:text-blue-500 transition-colors", isRTL && "rotate-180")}>
                    <ChevronRight size={20} />
                  </div>
                </div>
                
                <div className="w-full">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1">
                    {t(Config.labelKey)}
                  </h3>
                  <div className={cn("flex items-baseline gap-2 mb-2", isRTL && "flex-row-reverse")}>
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      {formatSize(stat.size)}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {t('itemsCount', { count: stat.count.toLocaleString() })}
                    </span>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className={cn("w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex", isRTL && "flex-row-reverse")}>
                    <div 
                      className={cn("h-full rounded-full transition-all duration-500 ease-out", Config.color.split(' ')[0])} // use text color class for bar
                      style={{ width: `${Math.max(percent, 1)}%`, backgroundColor: 'currentColor' }}
                    />
                  </div>
                  <div className={cn("mt-1 text-xs text-gray-400", isRTL ? "text-left" : "text-right")}>
                    {percent.toFixed(1)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
