import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, X, File, Folder, Loader2 } from 'lucide-react';
import { formatSize } from '../utils';

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
  t: (key: string) => string;
  currentPath?: string | null;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onOpenPath, t, currentPath }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const data = await invoke<SearchResult[]>('search_files', { query, rootPath: currentPath === "ALL_DISKS" ? null : currentPath });
      setResults(data);
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setLoading(false);
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
          {error && (
            <div className="p-4 text-red-500 text-center">{error}</div>
          )}
          
          {results.length === 0 && !loading && !error && query && (
            <div className="p-8 text-center text-gray-400">
              {t('noResults') || 'No results found'}
            </div>
          )}

          {results.length > 0 && (
            <div className="flex flex-col gap-1">
              {results.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    onOpenPath(result.path);
                    onClose();
                  }}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left transition-colors group"
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
              ))}
            </div>
          )}
          
          {!query && (
             <div className="p-8 text-center text-gray-400 text-sm">
               <p className="mb-2">Advanced Search Syntax:</p>
               <ul className="space-y-1">
                 <li><code>*.rs</code> - Regex/Glob pattern</li>
                 <li><code>size:&gt;100MB</code> - Size greater than 100MB</li>
                 <li><code>size:&lt;10KB</code> - Size less than 10KB</li>
                 <li><code>ext:png</code> - Extension filter</li>
               </ul>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};
