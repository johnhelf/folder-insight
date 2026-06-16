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

  useEffect(() => {
    if (!scanStartTime) {
        setElapsedMs(0);
        setLastSpeeds([]);
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

  const currentScannedSize = scanProgress?.scanned_size || 0;
  
  // ETA 平滑处理 - 使用更稳健的算法减少波动
  useEffect(() => {
    // 只有在获得总大小、已扫描部分内容且经过一定时间 (3s) 后才开始计算
    // 增加初始等待时间，因为初始扫描速度通常非常不稳定
    if (elapsedMs > 3000 && currentScannedSize > 0 && totalSize && totalSize > currentScannedSize) {
      const currentSpeed = currentScannedSize / (elapsedMs / 1000);
      
      // 记录最近的速度样本，增加窗口以获得更好的平滑度
      setLastSpeeds(prev => {
        const next = [...prev, currentSpeed].slice(-100); // 增加样本数量到 100
        return next;
      });

      // 计算平滑速度：使用修剪平均值
      if (lastSpeeds.length > 5) {
        // 移除最高和最低 20% 的样本以减少极端波动的影响
        const sortedSpeeds = [...lastSpeeds].sort((a, b) => a - b);
        const trimCount = Math.floor(sortedSpeeds.length * 0.2);
        const trimmedSpeeds = sortedSpeeds.slice(trimCount, sortedSpeeds.length - trimCount);
        
        if (trimmedSpeeds.length > 0) {
          // 计算修剪后的平均速度
          const avgSpeed = trimmedSpeeds.reduce((a, b) => a + b, 0) / trimmedSpeeds.length;
          
          const remaining = totalSize - currentScannedSize;
          // 限制最小速度，防止计算出天文数字般的 ETA
          const effectiveSpeed = Math.max(avgSpeed, 1024 * 1024); // 至少 1MB/s
          const newEta = (remaining / effectiveSpeed) * 1000;
          
          setSmoothEtaMs(prev => {
            if (prev === null) return newEta;
            
            // 极低平滑系数 (0.03) 以确保显示非常稳定但又能适应变化
            const alpha = 0.03;
            let smoothed = prev * (1 - alpha) + newEta * alpha;
            
            // 滞后逻辑：如果新旧 ETA 差异小于 1 秒，则保持旧值，避免视觉跳动
            const diff = Math.abs(smoothed - prev);
            if (diff < 1000) {
                return prev;
            }
            
            // 确保 ETA 不会比剩余时间更短（如果进度没变）
            return smoothed;
          });
        }
      }
    } else if (!scanProgress) {
      setSmoothEtaMs(null);
      setLastSpeeds([]);
    }
  }, [elapsedMs, currentScannedSize, totalSize, scanProgress]);

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
