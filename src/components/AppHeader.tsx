import { useState, useRef, useEffect } from "react";
import { HardDrive, Heart, TreeDeciduous, BarChart3, PieChart, Wrench, Files, Sparkles, ChevronDown, FolderOpen, MonitorPlay, RefreshCw, Languages, Info, Square } from "lucide-react";
import { cn, formatSize } from "../utils";
import { getLocaleNativeName } from "../i18n";
import { version } from "../../package.json";
import { FileNode, DiskStats, PhysicalDisk } from "../types";

interface AppHeaderProps {
  t: (key: string) => string;
  loading: boolean;
  data: FileNode | null;
  availableDisks: DiskStats[];
  physicalDisks: PhysicalDisk[];
  analyzeFullDisk: () => void;
  stopScan: () => void;
  handleSelectDrive: (path: string) => void;
  handleRefresh: () => void;
  handleSelectFolder: () => void;
  view: string;
  setView: (view: any) => void;
  isToolsMenuOpen: boolean;
  setIsToolsMenuOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  languageMode: string;
  setLanguageMode: (mode: any) => void;
  systemLocale: any;
  setIsSponsorModalOpen: (v: boolean) => void;
  setIsAboutModalOpen: (v: boolean) => void;
  isRTL: boolean;
}

export function AppHeader({
  t,
  loading,
  data,
  availableDisks,
  physicalDisks,
  analyzeFullDisk,
  stopScan,
  handleSelectDrive,
  handleRefresh,
  handleSelectFolder,
  view,
  setView,
  isToolsMenuOpen,
  setIsToolsMenuOpen,
  languageMode,
  setLanguageMode,
  systemLocale,
  setIsSponsorModalOpen,
  setIsAboutModalOpen,
  isRTL,
}: AppHeaderProps) {

  const [isScanMenuOpen, setIsScanMenuOpen] = useState(false);
  const scanMenuRef = useRef<HTMLDivElement>(null);

  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (scanMenuRef.current && !scanMenuRef.current.contains(event.target as Node)) {
        setIsScanMenuOpen(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        if (typeof setIsToolsMenuOpen === 'function') {
          setIsToolsMenuOpen(false);
        }
      }
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setIsLanguageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const languageOptions = [
    { mode: 'auto', label: `${t('languageAuto')} (${getLocaleNativeName(systemLocale)})` },
    { mode: 'zh', label: getLocaleNativeName('zh') },
    { mode: 'zh_tw', label: getLocaleNativeName('zh_tw') },
    { mode: 'en', label: getLocaleNativeName('en') },
    { mode: 'ja', label: getLocaleNativeName('ja') },
    { mode: 'ko', label: getLocaleNativeName('ko') },
    { mode: 'es', label: getLocaleNativeName('es') },
    { mode: 'fr', label: getLocaleNativeName('fr') },
    { mode: 'de', label: getLocaleNativeName('de') },
    { mode: 'ru', label: getLocaleNativeName('ru') },
    { mode: 'ar', label: getLocaleNativeName('ar') },
    { mode: 'it', label: getLocaleNativeName('it') },
  ] as const;

  return (
    <header className="flex items-center justify-between px-2 md:px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0 z-20 shadow-sm transition-colors duration-200">
      <div className="w-full flex items-center justify-between gap-4">
        {/* Logo Section */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <div className="w-9 h-9 md:w-10 md:h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
            <HardDrive size={20} className="md:w-6 md:h-6" />
          </div>
          <div className="hidden sm:block">
            <h1 className="flex items-end gap-2">
              <span className="text-lg md:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
                {t('appTitle')}
              </span>
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
                <button
                  onClick={() => setIsAboutModalOpen(true)}
                  className="hover:text-blue-500 transition-colors cursor-pointer mr-1"
                  title={t('about')}
                >
                  <Info size={14} />
                </button>
                v{version}
              </span>
            </h1>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          
          {/* 1. Scan Menu (Consolidated) */}
          <div className="relative flex items-center" ref={scanMenuRef}>
            {loading ? (
              <button
                onClick={() => {
                  stopScan();
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
              >
                <Square size={16} className="fill-current animate-pulse shrink-0" />
                <span className="hidden sm:inline whitespace-nowrap">{t('stopScan')}</span>
              </button>
            ) : (
              <div className="flex items-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-500/30 transition-colors hover:bg-blue-700 shrink-0">
                <button
                  onClick={() => {
                    handleSelectFolder();
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium border-r border-blue-500/50 hover:bg-blue-600/50 transition-colors rounded-l-lg"
                >
                  <FolderOpen size={16} className="shrink-0" />
                  <span className="hidden sm:inline whitespace-nowrap">{t('selectFolder')}</span>
                </button>
                <button
                  onClick={() => setIsScanMenuOpen(!isScanMenuOpen)}
                  className="px-2 py-2 hover:bg-blue-600/50 transition-colors rounded-r-lg flex items-center justify-center"
                >
                  <ChevronDown size={14} className={cn("transition-transform shrink-0", isScanMenuOpen && "rotate-180")} />
                </button>
              </div>
            )}

            {isScanMenuOpen && !loading && (
              <div className={cn(
                "absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-2 z-50",
                isRTL ? "left-0" : "right-0"
              )}>
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('scanOptions')}
                </div>
                
                <button
                  onClick={() => { handleSelectFolder(); setIsScanMenuOpen(false); }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                    <FolderOpen size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('selectFolder')}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('selectFolderDesc')}</div>
                  </div>
                </button>

                <button
                  onClick={() => { analyzeFullDisk(); setIsScanMenuOpen(false); }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                    <MonitorPlay size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('scanAllDisks')}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t('scanAllDisksDesc')}</div>
                  </div>
                </button>

                {(physicalDisks.length > 0 || availableDisks.length > 0) && (
                  <>
                    <div className="h-px bg-gray-100 dark:bg-gray-700 my-2" />
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('selectDrive')}</span>
                      <button 
                        onClick={loading ? undefined : handleRefresh} 
                        disabled={loading}
                        className={cn("text-gray-400 hover:text-blue-500 transition-colors", loading && "opacity-50 cursor-not-allowed")} 
                        title={t('refreshDrives')}
                      >
                        <RefreshCw size={12} className={cn(loading && "animate-spin")} />
                      </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {physicalDisks.length > 0 ? (
                        physicalDisks.map((disk) => (
                          <button
                            key={disk.number}
                            onClick={() => { handleSelectDrive(`PHYSICAL_DISK:${disk.number}`); setIsScanMenuOpen(false); }}
                            className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 transition-colors group"
                          >
                            <HardDrive size={16} className="text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-700 dark:text-gray-200 truncate font-medium">
                                {disk.name || `${t('physicalDisk')} ${disk.number}`}
                              </div>
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <span>{t('disk')}{disk.number} ({disk.partitions ? disk.partitions.split(',').map(p => `${p.trim().toUpperCase()}:`).join('、') : ''})</span>
                              </div>
                            </div>
                          </button>
                        ))
                      ) : (
                        availableDisks.map((disk) => (
                          <button
                            key={disk.mount_point}
                            onClick={() => { handleSelectDrive(disk.mount_point); setIsScanMenuOpen(false); }}
                            className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 transition-colors group"
                          >
                            <HardDrive size={16} className="text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-700 dark:text-gray-200 truncate font-medium">
                                {disk.name || t('localDisk')} ({disk.mount_point})
                              </div>
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                <span className={cn(
                                  disk.total > 0 && (disk.available / disk.total) < 0.1 ? "text-red-500" : "text-gray-400"
                                )}>
                                  {formatSize(disk.available)} {t('freeSpace')}
                                </span>
                                <span className="text-gray-300 dark:text-gray-600">/</span>
                                <span>{formatSize(disk.total)}</span>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 mx-1 hidden sm:block" />

          {/* 2. View Mode */}
          {data && (
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg shrink-0">
              {[
                { id: 'tree', icon: TreeDeciduous, label: t('treeView') },
                { id: 'treemap', icon: BarChart3, label: t('treemapView') },
                { id: 'chart', icon: BarChart3, label: t('chartView') },
                { id: 'fileType', icon: PieChart, label: t('fileTypeView') },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md text-sm font-medium transition-colors shrink-0",
                    view === item.id 
                      ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm" 
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700/50"
                  )}
                  title={item.label}
                >
                  <item.icon size={16} className={cn(item.id === 'chart' && "rotate-90", "shrink-0")} />
                    <span className="hidden 2xl:inline whitespace-nowrap">{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* 3. Tools */}
          <div className="relative" ref={toolsMenuRef}>
            <button
              onClick={(e) => {
                if (loading) return;
                e.stopPropagation();
                setIsToolsMenuOpen(!isToolsMenuOpen);
              }}
              disabled={loading}
              className={cn(
                "p-2 rounded-lg transition-colors",
                loading ? "opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800 text-gray-400" :
                isToolsMenuOpen 
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
              )}
              title={t('tools')}
            >
              <Wrench size={18} />
            </button>
            {isToolsMenuOpen && (
              <div className={cn(
                "absolute top-full mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-40",
                isRTL ? "left-0" : "right-0"
              )}>
                 <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('analysisTools')}
                </div>
                <button
                  onClick={() => { if (data && !loading) { setView('duplicates'); setIsToolsMenuOpen(false); } }}
                  disabled={loading}
                  className="w-full px-4 py-2 text-sm text-left flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Files size={16} className="text-gray-500" />
                  <div>
                    <div className="text-gray-700 dark:text-gray-200 font-medium">{t('findDuplicates')}</div>
                    <div className="text-xs text-gray-500">{t('findDuplicatesDesc')}</div>
                  </div>
                </button>
                <button
                  onClick={() => { if (data && !loading) { setView('aiInsights'); setIsToolsMenuOpen(false); } }}
                  disabled={loading}
                  className="w-full px-4 py-2 text-sm text-left flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles size={16} className="text-purple-500" />
                  <div>
                    <div className="text-gray-700 dark:text-gray-200 font-medium">{t('aiInsights')}</div>
                    <div className="text-xs text-gray-500">{t('smartAnalysis')}</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Sponsor */}
          <button
              onClick={() => setIsSponsorModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-pink-50 hover:bg-pink-100 dark:bg-pink-900/20 dark:hover:bg-pink-900/40 text-pink-600 dark:text-pink-400 transition-colors flex items-center gap-2 shrink-0"
              title={t('sponsor')}
            >
              <Heart size={16} />
              <span className="text-sm font-medium hidden lg:inline whitespace-nowrap">{t('sponsor')}</span>
            </button>

          {/* Language Toggle */}
            <div className="relative" ref={languageMenuRef}>
              <button
                  onClick={() => setIsLanguageMenuOpen(!isLanguageMenuOpen)}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors text-sm font-medium flex items-center gap-2 shrink-0"
                  title={t('languageTitle')}
                >
                  <Languages size={16} />
                  <span className="hidden md:inline">
                    {languageOptions.find(o => o.mode === languageMode)?.label || t('languageTitle')}
                  </span>
                </button>
            
            {isLanguageMenuOpen && (
               <div className={cn(
                "absolute top-full mt-2 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-40",
                isRTL ? "left-0" : "right-0"
              )}>
                 <div className="grid grid-cols-1 gap-1 px-2 py-2">
                    {languageOptions.map(lang => (
                      <button
                        key={lang.mode}
                        onClick={() => { setLanguageMode(lang.mode); setIsLanguageMenuOpen(false); }}
                        className={cn(
                          "px-3 py-1.5 text-sm rounded-md text-left transition-colors truncate",
                          languageMode === lang.mode 
                            ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-medium"
                            : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                        )}
                        title={lang.label}
                      >
                        {lang.label}
                      </button>
                    ))}
                 </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
