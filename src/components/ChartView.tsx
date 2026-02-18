import React, { useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { EChartsNode } from '../chartHelpers';
import { cn } from "../utils";
import { D3SunburstView } from './D3SunburstView';
import { ChevronLeft } from 'lucide-react';

interface ChartViewProps {
  chartData: EChartsNode | null; // This is the tree structure for Sunburst
  categoryData: any[]; // Keep for category mode
  t: (key: string, params?: Record<string, any>) => string;
  onDrillDown?: (path: string) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
}

export const ChartView: React.FC<ChartViewProps> = ({ 
  chartData, 
  categoryData,
  t, 
  onDrillDown,
  onGoUp,
  canGoUp
}) => {
  const [mode, setMode] = React.useState<'breakdown' | 'category'>('breakdown');
  const chartRef = useRef<any>(null);

  // ECharts 选项配置
  const getOption = () => {
    // 简单的饼图展示分类
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)'
      },
      series: [
        {
          name: t('categoryStatsTitle'),
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 10,
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: false,
            position: 'center'
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 20,
              fontWeight: 'bold'
            }
          },
          labelLine: {
            show: false
          },
          data: categoryData
        }
      ]
    };
  };

  const onChartClick = (_params: any) => {
    // Pie chart interactions if needed
  };
  
  return (
    <div className="p-0 h-full flex flex-col items-center relative w-full overflow-hidden">
      {/* Floating Header & Controls */}
      <div className="absolute top-4 left-0 w-full px-8 flex items-center justify-between z-10 pointer-events-none">
        {/* Left: Title & Navigation */}
        <div className="flex items-center gap-2 pointer-events-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm p-1.5 rounded-lg shadow-sm border border-gray-200/50 dark:border-gray-700/50">
          {canGoUp && (
            <button
              onClick={onGoUp}
              className="p-1.5 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 rounded-md transition-colors text-gray-600 dark:text-gray-400"
              title={t('goUp')}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 px-1">
            {mode === 'breakdown' ? t('topTitle') : t('categoryStatsTitle')}
          </h3>
        </div>

        {/* Right: Mode Switcher */}
        <div className="flex items-center gap-1 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm p-1 rounded-lg shadow-sm border border-gray-200/50 dark:border-gray-700/50 pointer-events-auto">
          <button
            onClick={() => setMode('breakdown')}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-all",
              mode === 'breakdown'
                ? "bg-blue-500 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            )}
          >
            {t('chartModeBreakdown')}
          </button>
          <button
            onClick={() => setMode('category')}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-all",
              mode === 'category'
                ? "bg-blue-500 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            )}
          >
            {t('chartModeCategory')}
          </button>
        </div>
      </div>

      <div className="w-full h-full min-h-0 relative">
        {mode === 'breakdown' ? (
          <D3SunburstView 
            data={chartData} 
            t={t} 
            onDrillDown={onDrillDown} 
            onGoUp={onGoUp} 
            canGoUp={canGoUp} 
          />
        ) : (
          <ReactECharts 
              ref={chartRef}
              option={getOption()} 
              style={{ height: '100%', width: '100%' }}
              onEvents={{
                  'click': onChartClick
              }}
              opts={{ renderer: 'svg' }}
          />
        )}
      </div>
    </div>
  );
};
