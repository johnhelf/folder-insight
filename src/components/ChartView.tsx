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
            {mode === 'breakdown' ? t('topTitle') : t('categoryStatsTitle')}
          </h3>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setMode('breakdown')}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-all",
              mode === 'breakdown'
                ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            )}
          >
            {t('chartModeBreakdown')}
          </button>
          <button
            onClick={() => setMode('category')}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-all",
              mode === 'category'
                ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            )}
          >
            {t('chartModeCategory')}
          </button>
        </div>
      </div>

      <div className="w-full flex-1 min-h-0">
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
