import React from 'react';
import { EChartsNode } from '../chartHelpers';
import { D3TreemapView } from './D3TreemapView';
import { ChevronLeft, Home } from 'lucide-react';

interface TreemapViewProps {
  data: EChartsNode | null;
  t: (key: string, params?: Record<string, string>) => string;
  onDrillDown?: (path: string) => void;
  onGoUp?: () => void;
  onGoRoot?: () => void;
  onContextMenu?: (e: React.MouseEvent | MouseEvent, path: string) => void;
  canGoUp?: boolean;
  currentPath?: string;
}

export const TreemapView: React.FC<TreemapViewProps> = ({ 
  data, 
  t, 
  onDrillDown,
  onGoUp,
  onGoRoot,
  onContextMenu,
  canGoUp,
  currentPath
}) => {
  return (
    <div className="p-2 md:p-4 h-full flex flex-col items-center relative w-full">
      <div className="w-full flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          {canGoUp && (
            <>
              {onGoRoot && (
                <button
                  onClick={onGoRoot}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-400"
                  title={t('rootDirectory')}
                >
                  <Home size={20} />
                </button>
              )}
              <button
                onClick={onGoUp}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-400"
                title={t('goUp')}
              >
                <ChevronLeft size={20} />
              </button>
            </>
          )}
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            {t('treemapTitle')}
            {currentPath && (
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400 truncate max-w-[300px] border-l border-gray-300 dark:border-gray-600 pl-2 ml-2 hidden sm:inline-block">
                    {currentPath}
                </span>
            )}
          </h3>
        </div>
      </div>

      <div className="w-full flex-1 min-h-0">
         <D3TreemapView 
            data={data}
            onDrillDown={onDrillDown}
            onContextMenu={onContextMenu}
        />
      </div>
    </div>
  );
};
