import React from 'react';
import { EChartsNode } from '../chartHelpers';
import { D3TreemapView } from './D3TreemapView';
import { ChevronLeft } from 'lucide-react';

interface TreemapViewProps {
  data: EChartsNode | null;
  t: (key: string, params?: Record<string, string>) => string;
  onDrillDown?: (path: string) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
}

export const TreemapView: React.FC<TreemapViewProps> = ({ 
  data, 
  t, 
  onDrillDown,
  onGoUp,
  canGoUp
}) => {
  return (
    <div className="p-4 md:p-8 h-full flex flex-col items-center relative w-full">
      <div className="w-full flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          {canGoUp && (
            <button
              onClick={onGoUp}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-400"
              title={t('goUp')}
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            {t('treemapTitle')}
          </h3>
        </div>
      </div>

      <div className="w-full flex-1 min-h-0">
         <D3TreemapView 
            data={data}
            onDrillDown={onDrillDown}
        />
      </div>
    </div>
  );
};
