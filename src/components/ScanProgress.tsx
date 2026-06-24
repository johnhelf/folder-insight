import { Loader2, Clock } from "lucide-react";
import { ProgressUpdate } from "../types";
import { useState, useEffect } from "react";
import { formatSize, cn, getTranslatedNodeName } from "../utils";

interface ScanProgressProps {
  t: (key: string, params?: Record<string, string | number>) => string;
  scanProgress: ProgressUpdate | null;
  scanStartTime: number | null;
  isRTL?: boolean;
  totalSize?: number | null;
}

export function ScanProgress({ t, scanProgress, scanStartTime, isRTL, totalSize }: ScanProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [smoothEtaMs, setSmoothEtaMs] = useState<number | null>(null);
  const [lastSpeeds, setLastSpeeds] = useState<number[]>([]);
  const [prevSnapshot, setPrevSnapshot] = useState({ size: 0, time: 0 });

  useEffect(() => {
    if (!scanStartTime) {
        setElapsedMs(0);
        setLastSpeeds([]);
        setPrevSnapshot({ size: 0, time: 0 });
        return;
    }
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - scanStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [scanStartTime]);

  const formatTime = (ms: number) => {
    if (!isFinite(ms) || ms < 0) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const currentScannedSize = scanProgress?.scanned_allocated_size || scanProgress?.scanned_size || 0;
  
  // ETA 算法优化：使用真实的瞬时速度滑动窗口
  useEffect(() => {
    if (elapsedMs > 2000 && currentScannedSize > 0) {
      const deltaSize = currentScannedSize - prevSnapshot.size;
      const deltaTime = (elapsedMs - prevSnapshot.time) / 1000;
      
      if (deltaTime >= 1.0) { // 每秒采样一次瞬时速度
        const instantSpeed = deltaSize / deltaTime;
        setPrevSnapshot({ size: currentScannedSize, time: elapsedMs });
        
        setLastSpeeds(prev => {
          // 保留最近 15 秒的瞬时速度
          const next = [...prev, instantSpeed].slice(-15);
          return next;
        });
      }

      if (lastSpeeds.length > 3) {
        // 去除最高和最低极值，计算平均瞬时速度
        const sortedSpeeds = [...lastSpeeds].sort((a, b) => a - b);
        const trimCount = Math.floor(sortedSpeeds.length * 0.2);
        const trimmedSpeeds = sortedSpeeds.slice(trimCount, sortedSpeeds.length - trimCount);
        
        if (trimmedSpeeds.length > 0) {
          const avgSpeed = trimmedSpeeds.reduce((a, b) => a + b, 0) / trimmedSpeeds.length;
          
          // 如果 scannedSize 超过了物理可用空间（因硬链接/压缩），预估剩余少量时间
          let remaining = 0;
          if (totalSize && totalSize > currentScannedSize) {
              remaining = totalSize - currentScannedSize;
          } else {
              remaining = currentScannedSize * 0.02; // 溢出后保守估计剩余 2%
          }

          // 限制最小速度 10MB/s，防止 ETA 突然跳到几个小时
          const effectiveSpeed = Math.max(avgSpeed, 10 * 1024 * 1024); 
          const newEta = (remaining / effectiveSpeed) * 1000;
          
          setSmoothEtaMs(prev => {
            if (prev === null) return newEta;
            // 阻尼系数，让时间平滑递减而不剧烈跳动
            const alpha = 0.1;
            let smoothed = prev * (1 - alpha) + newEta * alpha;
            return smoothed;
          });
        }
      }
    } else if (!scanProgress) {
      setSmoothEtaMs(null);
      setLastSpeeds([]);
      setPrevSnapshot({ size: 0, time: 0 });
    }
  }, [elapsedMs, currentScannedSize, totalSize, scanProgress, prevSnapshot]);

  const speedBytesPerSec = elapsedMs > 0 ? (currentScannedSize / (elapsedMs / 1000)) : 0;
  
  // 只要有 totalSize 且正在扫描，就尝试显示百分比
  const hasTotal = totalSize && totalSize > 0;
  const percentage = hasTotal ? Math.min(99.9, (currentScannedSize / totalSize) * 100) : null;
  
  if (!scanProgress && !scanStartTime) return null;

  return (
    <div className="w-full bg-white dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 mb-6">
        <div className={cn("flex items-center justify-between mb-2", isRTL && "flex-row-reverse")}>
             <div className={cn("flex items-center gap-2 overflow-hidden", isRTL && "flex-row-reverse")}>
                 <Loader2 className="animate-spin text-blue-500 shrink-0" size={16} />
                 <div className="flex flex-col min-w-0">
                     <span className="font-medium text-sm text-gray-700 dark:text-gray-200 truncate max-w-xl" title={scanProgress?.current_path}>
                         {scanProgress ? (scanProgress.current_path ? getTranslatedNodeName(scanProgress.current_path, t) : t('scanning')) : t('preparingScan')}
                     </span>
                 </div>
             </div>
             <div className={cn("flex items-center gap-2 text-xs text-gray-500 font-mono shrink-0", isRTL && "flex-row-reverse")}>
                 <Clock size={14} />
                 <span>{formatTime(elapsedMs)}</span>
             </div>
        </div>
        
        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden relative">
            {percentage !== null ? (
                <div 
                    className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${percentage}%` }}
                ></div>
            ) : (
                <>
                    <div 
                        className="h-full bg-blue-500 rounded-full absolute top-0 left-0 animate-[progress_2s_ease-in-out_infinite]"
                        style={{ width: '30%' }}
                    ></div>
                    <style>{`
                        @keyframes progress {
                            0% { left: -30%; width: 30%; }
                            50% { left: 35%; width: 30%; }
                            100% { left: 100%; width: 30%; }
                        }
                    `}</style>
                </>
            )}
        </div>
        
        <div className={cn("flex justify-between mt-1 text-xs text-gray-400", isRTL && "flex-row-reverse")}>
             <div className={cn("flex items-center gap-3", isRTL && "flex-row-reverse")}>
                 <span>{scanProgress ? t('scannedCount', { count: scanProgress.scanned_count.toLocaleString() }) : t('calculating')}</span>
                 {speedBytesPerSec > 0 && (
                     <span>{formatSize(speedBytesPerSec)}/s</span>
                 )}
             </div>
             <div className={cn("flex items-center gap-3", isRTL && "flex-row-reverse")}>
                 {smoothEtaMs !== null && (
                     <span>{t('eta')}: {formatTime(smoothEtaMs)}</span>
                 )}
                 <span>
                     {scanProgress ? formatSize(currentScannedSize) : '...'}
                     {hasTotal && ` / ${formatSize(totalSize)}`}
                     {percentage !== null && ` (${percentage.toFixed(1)}%)`}
                 </span>
             </div>
        </div>
    </div>
  );
}
