import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, FolderOpen, AlertCircle, FileText } from "lucide-react";
import { formatSize } from "../utils";

interface DuplicateGroup {
    hash: string;
    size: number;
    files: string[];
}

interface DuplicateScanProgress {
    phase: string;
    total_files: number;
    processed_files: number;
    current_path: string;
}

interface DuplicatesViewProps {
    t: (key: string) => string;
    isRTL: boolean;
    targetDirs: string[];
    onOpenInExplorer: (path: string) => void;
}

export function DuplicatesView({ t, targetDirs, onOpenInExplorer }: DuplicatesViewProps) {
    const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState<DuplicateScanProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [minSize, setMinSize] = useState<number>(1024 * 1024); // 1MB default

    const startScan = async () => {
        setIsScanning(true);
        setError(null);
        setDuplicates([]);
        setProgress(null);

        let unlisten: (() => void) | undefined;

        try {
            unlisten = await listen<DuplicateScanProgress>('duplicate-scan-progress', (event) => {
                setProgress(event.payload);
            });

            // If targetDirs is empty (All Disks), we'd need to fetch all disks here or handle it differently
            // For now, let's assume targetDirs has paths.
            let dirsToScan = targetDirs;
            if (dirsToScan.length === 0) {
                // If we want to scan all disks for duplicates, we need to get them
                const stats: any[] = await invoke("get_all_disk_stats");
                dirsToScan = stats.map(s => s.mount_point);
            }

            const result = await invoke<DuplicateGroup[]>("find_duplicates", {
                options: {
                    min_size: minSize,
                    max_size: null,
                    included_extensions: null,
                    target_dirs: dirsToScan
                }
            });

            // Sort by size descending
            result.sort((a, b) => b.size - a.size);
            setDuplicates(result);
        } catch (err) {
            console.error("Duplicate scan failed:", err);
            setError(typeof err === "string" ? err : "Failed to scan for duplicates");
        } finally {
            setIsScanning(false);
            if (unlisten) unlisten();
        }
    };

    const totalWastedSpace = duplicates.reduce((acc, group) => acc + group.size * (group.files.length - 1), 0);

    return (
        <div className="h-full flex flex-col p-4">
            <div className="flex items-center gap-4 mb-6 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                <div>
                    <label className="block text-xs text-gray-500 mb-1">{t('minFileSize')}</label>
                    <select 
                        value={minSize} 
                        onChange={(e) => setMinSize(Number(e.target.value))}
                        disabled={isScanning}
                        className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm"
                    >
                        <option value={1024 * 1024}>1 MB</option>
                        <option value={10 * 1024 * 1024}>10 MB</option>
                        <option value={100 * 1024 * 1024}>100 MB</option>
                        <option value={500 * 1024 * 1024}>500 MB</option>
                    </select>
                </div>
                
                <button
                    onClick={startScan}
                    disabled={isScanning}
                    className="mt-5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                    {isScanning ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                    {isScanning ? t('scanning') : t('findDuplicates')}
                </button>

                {!isScanning && duplicates.length > 0 && (
                    <div className="mt-5 ml-auto flex items-center gap-2 text-orange-600 dark:text-orange-400 font-medium">
                        <AlertCircle size={18} />
                        <span>{t('wastedSpace')}: {formatSize(totalWastedSpace)}</span>
                    </div>
                )}
            </div>

            {error && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm border border-red-200">
                    {error}
                </div>
            )}

            {isScanning && progress && (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                    <Loader2 size={48} className="animate-spin text-blue-500 mb-4" />
                    <h3 className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-2">{t(progress.phase)}</h3>
                    <p className="text-sm mb-4">
                        {progress.processed_files.toLocaleString()} / {progress.total_files.toLocaleString()} {t('filesCount').replace('{count}', '')}
                    </p>
                    <div className="w-64 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
                        <div 
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${progress.total_files > 0 ? (progress.processed_files / progress.total_files) * 100 : 0}%` }}
                        />
                    </div>
                    <p className="text-xs max-w-md text-center truncate px-4" title={progress.current_path}>
                        {progress.current_path}
                    </p>
                </div>
            )}

            {!isScanning && duplicates.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                    <FileText size={64} className="opacity-20 mb-4" />
                    <p>{t('noDuplicates')}</p>
                </div>
            )}

            {!isScanning && duplicates.length > 0 && (
                <div className="flex-1 overflow-auto pr-2 custom-scrollbar space-y-4">
                    {duplicates.map((group, idx) => (
                        <div key={idx} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                            <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">{t('group')} {idx + 1}</span>
                                    <span className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">
                                        {t('filesCount').replace('{count}', group.files.length.toString())}
                                    </span>
                                </div>
                                <div className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">
                                    {formatSize(group.size)} each
                                </div>
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {group.files.map((file, fIdx) => (
                                    <div key={fIdx} className="px-4 py-2 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                                        <div className="truncate text-sm text-gray-600 dark:text-gray-300 mr-4 font-mono" title={file}>
                                            {file}
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button 
                                                onClick={() => onOpenInExplorer(file)}
                                                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                                title={t('openInExplorer')}
                                            >
                                                <FolderOpen size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}