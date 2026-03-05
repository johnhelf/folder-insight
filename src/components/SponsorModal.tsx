import React from 'react';
import { Heart, X } from 'lucide-react';

interface SponsorModalProps {
  isOpen: boolean;
  onClose: () => void;
  t: (key: string, params?: Record<string, string>) => string;
  isRTL?: boolean;
}

export const SponsorModal: React.FC<SponsorModalProps> = ({ isOpen, onClose, t, isRTL = false }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isRTL ? "rtl" : "ltr"}>
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-pink-100 dark:bg-pink-900/30 rounded-full flex items-center justify-center text-pink-600 dark:text-pink-400">
                <Heart size={20} className="fill-pink-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{t('sponsorTitle')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('sponsorSubtitle')}</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 dark:text-gray-400"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {/* 国内扫码区域 / Domestic QR Code */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col items-center">
              <div className="w-40 h-40 bg-white p-2 rounded-lg shadow-inner mb-2 flex items-center justify-center overflow-hidden">
                <img 
                  src="/sponsor-qr.png" 
                  alt="Sponsor QR Code"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    if (e.currentTarget.parentElement) {
                        e.currentTarget.parentElement.innerHTML = `
                          <div class="text-gray-300 text-[10px] italic text-center">
                            Alipay QR<br/>(sponsor-qr.png)
                          </div>
                        `;
                    }
                  }}
                />
              </div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Alipay</p>
            </div>

            {/* 海外支付链接区域 / International Payment Link */}
            <div className="flex flex-col gap-2">
              <a
                href="https://buymeacoffee.com/johnhelf" 
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2 bg-[#FFDD00] hover:bg-[#ffed4a] text-black rounded-xl font-bold text-sm transition-colors"
              >
                <img src="https://cdn.buymeacoffee.com/buttons/bmc-new-btn-logo.svg" alt="BMC" className="w-4 h-4" />
                <span>Buy Me a Coffee</span>
              </a>
              
              <p className="text-[10px] text-gray-400 text-center">
                {t('sponsorSubtitle')}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl font-semibold hover:opacity-90 transition-opacity"
            >
              {t('close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
