import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, X, File, Folder, Loader2, FolderOpen, Trash2, History } from 'lucide-react';
import { formatSize } from '../utils';
import { UnifiedState } from './UnifiedState';

interface SearchResult {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPath: (path: string) => void;
  onOpenInExplorer: (path: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  currentPath?: string | null;
}

const HISTORY_KEY = 'folder-insight:search-history';
const MAX_HISTORY = 10;
// 单次搜索最多展示条数（避免列表过长）
const MAX_RESULTS_DISPLAY = 1000;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(queries: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(queries.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onOpenPath, onOpenInExplorer, t, currentPath }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setLoading(true);
    setError(null);
    setResults([]);

    // 记录搜索历史（去重，最新在前）
    setHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });

    try {
      const data = await invoke<SearchResult[]>('search_files', { query: q, rootPath: currentPath === "ALL_DISKS" ? null : currentPath });
      setResults(data);
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    runSearch(query);
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // 忽略
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-16 right-4 z-50 w-full max-w-md pointer-events-auto">
      <div 
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <Search className="text-gray-400" />
          <form onSubmit={handleSearch} className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder') || "Search files (e.g. *.rs, size:>100MB)..."}
              className="w-full bg-transparent border-none outline-none text-lg text-gray-800 dark:text-gray-100 placeholder-gray-400"
            />
          </form>
          {loading && <Loader2 className="animate-spin text-blue-500" />}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {!query && !loading && history.length > 0 && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                  <History size={14} />
                  {t('searchHistory')}
                </span>
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={12} />
                  {t('clearHistory')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((h, idx) => (
                  <button
                    key={idx}
                    onClick={() => runSearch(h)}
                    className="px-2.5 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-300 transition-colors truncate max-w-full"
                    title={h}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!query && (
             <div className="p-8 text-center text-gray-400 text-sm">
               <p className="mb-2">{t('advancedSearchSyntax')}</p>
               <ul className="space-y-1">
                 <li><code>*.rs</code> {t('searchHintRegex')}</li>
                 <li><code>size:&gt;100MB</code> {t('searchHintSizeGt')}</li>
                 <li><code>size:&lt;10KB</code> {t('searchHintSizeLt')}</li>
                 <li><code>ext:png</code> {t('searchHintExt')}</li>
               </ul>
             </div>
          )}

          {error ? (
            <UnifiedState variant="error" title={t('searchFailed')} hint={error} />
          ) : results.length === 0 && !loading && query ? (
            <UnifiedState variant="empty" title={t('noResults')} />
          ) : results.length > 0 ? (
            <>
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                {t('searchResultCount', { count: results.length.toLocaleString() })}
                {results.length > MAX_RESULTS_DISPLAY && `（${t('searchResultLimitHint')}）`}
              </div>
              <div className="flex flex-col gap-1">
                {results.slice(0, MAX_RESULTS_DISPLAY).map((result, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  >
                    <button
                      onClick={() => {
                        if (result.is_dir) {
                          onOpenPath(result.path);
                          onClose();
                        } else {
                          onOpenInExplorer(result.path);
                        }
                      }}
                      className="flex flex-1 items-center gap-3 p-3 text-left transition-colors min-w-0"
                      title={result.is_dir ? result.path : `${result.path} (file)`}
                    >
                      <div className="shrink-0 text-gray-400 group-hover:text-blue-500">
                        {result.is_dir ? <Folder size={20} /> : <File size={20} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                          {result.name}
                        </div>
                        <div className="text-xs text-gray-500 truncate" title={result.path}>
                          {result.path}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 font-mono whitespace-nowrap">
                        {formatSize(result.size)}
                      </div>
                    </button>
                    <button
                      onClick={() => onOpenInExplorer(result.path)}
                      className="p-2 shrink-0 text-gray-400 hover:text-blue-500 transition-colors"
                      title={t('openInExplorer')}
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};