import React, { useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { EChartsNode } from '../chartHelpers';
import { cn } from "../utils";
import { D3SunburstView } from './D3SunburstView';
import { ChevronLeft, Home } from 'lucide-react';

interface ChartViewProps {
  chartData: EChartsNode | null; // This is the tree structure for Sunburst
  categoryData: any[]; // Keep for category mode
  t: (key: string, params?: Record<string, any>) => string;
  onDrillDown?: (path: string) => void;
  onGoUp?: () => void;
  onGoRoot?: () => void;
  onContextMenu?: (e: React.MouseEvent | MouseEvent, path: string) => void;
  canGoUp?: boolean;
  currentPath?: string;
}

export const ChartView: React.FC<ChartViewProps> = ({ 
  chartData, 
  categoryData,
  t, 
  onDrillDown,
  onGoUp,
  onGoRoot,
  onContextMenu,
  canGoUp,
  currentPath
}) => {
  const [mode, setMode] = React.useState<'breakdown' | 'category'>('breakdown');
  const chartRef = useRef<any>(null);

  // ECharts 选项配置
  const getOption = () => {
    // 简单的饼图展示分类
    const data = categoryData;
    const categories = data.map(item => item.name);
    
    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const item = params.data;
          // For pie chart, percent is available. For bar chart, we might need to calculate it or just show size.
          const percentStr = params.percent ? ` (${params.percent}%)` : '';
          return `${item.name}: ${item.formattedSize}${percentStr}`;
        }
      },
      grid: {
        left: '55%', // Bar chart on the right
        right: '2%', 
        top: '2%',
        bottom: '2%',
        containLabel: true
      },
      xAxis: {
        type: 'value',
        show: false, // Hide x-axis for cleaner look
        splitLine: { show: false }
      },
      yAxis: {
        type: 'category',
        data: categories,
        inverse: true, // Top items first
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          width: 80,
          overflow: 'truncate'
        }
      },
      series: [
        {
          name: t('categoryStatsTitle'),
          type: 'bar',
          data: data,
          barWidth: '60%',
          itemStyle: {
            borderRadius: 4,
            color: (params: any) => {
              // Use a palette or consistent colors if needed
              const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];
              return colors[params.dataIndex % colors.length];
            }
          },
          label: {
            show: true,
            position: 'right',
            formatter: (params: any) => params.data.formattedSize
          }
        },
        {
          name: t('categoryStatsTitle'),
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['25%', '50%'], // Position on the left side
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
              fontWeight: 'bold',
              formatter: '{b}\n{c}'
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
        <div className="flex items-center gap-2 pointer-events-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm p-1.5 rounded-lg shadow-sm border border-gray-200/50 dark:border-gray-700/50 max-w-[70%]">
           {canGoUp && (
               <>
                 {onGoRoot && (
                     <button
                     onClick={onGoRoot}
                     className="p-1.5 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 rounded-md transition-colors text-gray-600 dark:text-gray-400 shrink-0"
                     title={t('rootDirectory')}
                     >
                     <Home size={18} />
                     </button>
                 )}
                 <button
                 onClick={onGoUp}
                 className="p-1.5 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 rounded-md transition-colors text-gray-600 dark:text-gray-400 shrink-0"
                 title={t('goUp')}
                 >
                 <ChevronLeft size={18} />
                 </button>
               </>
           )}
           <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 px-1 shrink-0">
               {mode === 'breakdown' ? t('topTitle') : t('categoryStatsTitle')}
           </h3>
           {/* Current Path Display */}
           {currentPath && (
               <div className="border-l border-gray-300 dark:border-gray-600 pl-2 ml-1 truncate text-xs text-gray-500 dark:text-gray-400 min-w-0" title={currentPath}>
                   {currentPath}
               </div>
           )}
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

      <div className="w-full h-full min-h-0 relative pt-16">
        {mode === 'breakdown' ? (
          <D3SunburstView 
            data={chartData} 
            t={t} 
            onDrillDown={onDrillDown} 
            onGoUp={onGoUp} 
            canGoUp={canGoUp} 
            onContextMenu={onContextMenu}
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
