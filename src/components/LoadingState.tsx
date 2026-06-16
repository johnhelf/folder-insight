import { Loader2, Clock, HardDrive } from "lucide-react";
import { ProgressUpdate } from "../types";
import { useState, useEffect } from "react";
import { formatSize } from "../utils";

interface LoadingStateProps {
  t: (key: string, params?: Record<string, string | number>) => string;
  scanProgress: ProgressUpdate | null;
  scanStartTime: number | null;
}

export function LoadingState({ t, scanProgress, scanStartTime }: LoadingStateProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!scanStartTime) return;

    const interval = setInterval(() => {
      setElapsedMs(Date.now() - scanStartTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [scanStartTime]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
      <p className="text-gray-500">{t('analyzing')}</p>
      {scanProgress && (
        <div className="mt-8 w-full max-w-xl px-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm w-full">
             <div className="flex justify-between items-end mb-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('scannedCount', { count: scanProgress.scanned_count.toLocaleString() })}
                    </span>
                    <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {formatSize(scanProgress.scanned_size)}
                    </span>
                  </div>
                  {scanProgress.disk_name && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium">
                      <HardDrive size={12} />
                      <span>{scanProgress.disk_name}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 gap-1.5 font-mono bg-gray-50 dark:bg-gray-900 px-2.5 py-1 rounded-md border border-gray-100 dark:border-gray-800">
                    <Clock size={14} className="text-blue-500" />
                    <span>{formatTime(elapsedMs)}</span>
                  </div>
                </div>
             </div>
             
             {/* Simple progress bar animation */}
             <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-blue-500 rounded-full w-full origin-left animate-[pulse_1.5s_ease-in-out_infinite]" style={{ transform: 'scaleX(0.7)' }}></div>
             </div>
             
             <div className="bg-gray-50 dark:bg-gray-900/50 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500 truncate font-mono" title={scanProgress.current_path} dir="ltr">
                  {scanProgress.current_path}
                </p>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
