import { HardDrive, Folder, Files } from "lucide-react";
import { cn, formatSize, getTranslatedNodeName } from "../utils";
import { getRealtimeSummary, normalizePathForMatch } from "../utils/treeUtils";
import { FileNode, DiskStats, ProgressUpdate, PhysicalDisk } from "../types";

interface StatsGridProps {
  data: FileNode;
  view: string;
  sizeMetric: 'logical' | 'allocated';
  setSizeMetric: (m: 'logical' | 'allocated') => void;
  availableDisks: DiskStats[];
  scanProgress: ProgressUpdate | null;
  t: (key: string) => string;
  numberLocale: string;
  isReceivingUpdates: boolean;
  physicalDisks?: PhysicalDisk[];
}

export function StatsGrid({
  data,
  view,
  sizeMetric,
  setSizeMetric,
  availableDisks,
  t,
  numberLocale,
  isReceivingUpdates,
  physicalDisks = [],
}: StatsGridProps) {
  
  const getRelevantDisks = () => {
    if (data.path === "ALL_DISKS") {
      return availableDisks;
    }
    if (data.path.startsWith("PHYSICAL_DISK:")) {
      const diskNum = parseInt(data.path.split(":")[1] || "0", 10);
      const physDisk = physicalDisks.find(d => d.number === diskNum);
      if (physDisk && physDisk.partitions) {
        const letters = physDisk.partitions.split(',').map(p => p.trim().toUpperCase());
        return availableDisks.filter(d => {
          const driveLetter = d.mount_point.charAt(0).toUpperCase();
          return letters.includes(driveLetter);
        });
      }
      return [];
    }
    // For regular folders or specific drives, find the longest matching mount point
    let bestMatch: DiskStats | null = null;
    let bestMatchLen = 0;
    for (const disk of availableDisks) {
      if (data.path.toLowerCase().startsWith(disk.mount_point.toLowerCase())) {
        if (disk.mount_point.length > bestMatchLen) {
          bestMatch = disk;
          bestMatchLen = disk.mount_point.length;
        }
      }
    }
    return bestMatch ? [bestMatch] : [];
  };

  const relevantDisks = getRelevantDisks();
  const totalFreeSpace = relevantDisks.reduce((acc, d) => acc + d.available, 0);
  const totalDiskSpace = relevantDisks.reduce((acc, d) => acc + d.total, 0);

  const isDriveRoot = relevantDisks.some(d => {
      const p1 = normalizePathForMatch(data.path);
      const p2 = normalizePathForMatch(d.mount_point);
      return p1 === p2 || p1 === p2 + '/';
  });

  const showFreeSpace = data.path === "ALL_DISKS" || data.path.startsWith("PHYSICAL_DISK:") || isDriveRoot;

  return (
    <div className="flex flex-col space-y-4 w-full shrink-0">
      {view === 'tree' ? (
        <div className="grid gap-4 shrink-0 grid-cols-2 md:grid-cols-4">
          {/* Total Size */}
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

          {/* Free Space - Only show for drives or full system scan */}
          {showFreeSpace && relevantDisks.length > 0 ? (
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1.5">
                      <HardDrive size={14} /> {t('freeSpace')}
                  </div>
                  <div className="text-xl font-bold">
                      {formatSize(totalFreeSpace)}
                      <span className="text-xs font-normal text-gray-400 ml-2">
                          / {formatSize(totalDiskSpace)}
                      </span>
                  </div>
              </div>
          ) : null}

          {/* Total Files */}
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

          {/* Root Directory (or Scan Status if moved) */}
           {data.path === "ALL_DISKS" || data.path.startsWith("PHYSICAL_DISK:") ? (
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                   <div className="text-gray-500 text-xs mb-1 flex items-center gap-1.5">
                      <Folder size={14} /> {t('rootDirectory')}
                    </div>
                    <div className="text-base font-semibold truncate" title={data.name as string}>
                      {getTranslatedNodeName(data.name, t)}
                    </div>
              </div>
           ) : (
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1.5">
                      <HardDrive size={14} /> {t('path')}
                  </div>
                  <div className="text-sm font-mono truncate text-gray-600 dark:text-gray-300" title={data.path as string}>
                      {data.path}
                  </div>
              </div>
           )}
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
                {getTranslatedNodeName(data.name, t)}
              </div>
          </div>
        </div>
      )}

      </div>
    );
}
