import { Star, X, Info, ExternalLink } from 'lucide-react';
import { version } from '../../package.json';
import { openUrl } from '@tauri-apps/plugin-opener';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  t: (key: string) => string;
  onRateClick: () => void;
}

export function AboutModal({ isOpen, onClose, t, onRateClick }: AboutModalProps) {
  if (!isOpen) return null;

  return (
    <div className="relative z-50">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      
      <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div className="mx-auto max-w-sm rounded-2xl bg-white dark:bg-gray-800 shadow-2xl p-6 border border-gray-200 dark:border-gray-700 w-full pointer-events-auto">
          <div className="flex justify-between items-start mb-6">
            <div className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Info className="text-blue-500" />
              {t('about')}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col items-center text-center space-y-4 mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Info size={40} />
            </div>
            
            <div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Folder Insight</h3>
              <p className="text-gray-500 dark:text-gray-400 mt-1">Version {version}</p>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">By 晓宇映辰</p>
            </div>

            <p className="text-gray-600 dark:text-gray-300 text-sm max-w-[250px]">
              {t('aboutDescription') || "A fast, modern, and open-source disk space analyzer."}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                onClose();
                onRateClick();
              }}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Star size={18} />
              {t('rateApp')}
            </button>
            
            <button
              onClick={() => {
                openUrl("https://github.com/johnhelf/folder-insight");
              }}
              className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink size={18} />
              GitHub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
