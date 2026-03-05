import React from 'react';
import { Star, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_CONFIG } from '../config';

interface RateModalProps {
  isOpen: boolean;
  onClose: () => void;
  t: (key: string, params?: Record<string, string>) => string;
  isRTL?: boolean;
}

export const RateModal: React.FC<RateModalProps> = ({ isOpen, onClose, t, isRTL = false }) => {
  if (!isOpen) return null;

  /**
   * 处理评分按钮点击：尝试打开 Windows Store 深层链接，失败则打开网页。
   * Handle rate button click: try to open Windows Store deep link, fallback to web URL.
   */
  const handleRate = async () => {
    try {
        // Try deep link first (Windows Store Protocol)
        await openUrl(APP_CONFIG.RATE_URL.MS_STORE);
    } catch (e) {
        console.warn('Failed to open deep link, falling back to web url', e);
        // Fallback to web url
        await openUrl(APP_CONFIG.RATE_URL.WEB);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isRTL ? "rtl" : "ltr"}>
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center text-yellow-600 dark:text-yellow-400">
                <Star size={20} className="fill-yellow-500" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('rateTitle')}</h2>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 dark:text-gray-400"
            >
              <X size={20} />
            </button>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            {t('rateSubtitle')}
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleRate}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
            >
              <Star size={16} className="fill-white/20" />
              {t('rateButton')}
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl font-semibold transition-colors"
            >
              {t('rateLater')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
