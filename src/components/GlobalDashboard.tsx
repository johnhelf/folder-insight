import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as echarts from 'echarts';
import { HardDrive, RefreshCw, AlertCircle } from 'lucide-react';
import { DiskStats } from '../types';
import { formatSize, cn } from '../utils';

interface GlobalDashboardProps {
  t: (key: string, params?: Record<string, any>) => string;
  isRTL?: boolean;
}

export const GlobalDashboard: React.FC<GlobalDashboardProps> = ({ t, isRTL = false }) => {
  const [disks, setDisks] = useState<DiskStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const fetchDiskStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const stats = await invoke<DiskStats[]>("get_all_disk_stats");
      setDisks(stats);
      updateChart(stats);
    } catch (err: any) {
      console.error("Failed to fetch disk stats:", err);
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiskStats();

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstance.current?.dispose();
    };
  }, []);

  const updateChart = (data: DiskStats[]) => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const diskNames = data.map(d => d.name || d.mount_point);
    const usedData = data.map(d => d.used);
    const freeData = data.map(d => d.available);

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let result = `<div class="font-bold mb-1">${params[0].name}</div>`;
          params.forEach((item: any) => {
            result += `<div class="flex justify-between gap-4">
              <span style="color:${item.color}">● ${item.seriesName}</span>
              <span class="font-mono">${formatSize(item.value)}</span>
            </div>`;
          });
          // Add Total
          const diskIndex = params[0].dataIndex;
          const total = data[diskIndex].total;
          result += `<div class="border-t border-gray-500/30 mt-1 pt-1 flex justify-between gap-4 font-semibold">
            <span>${t('total') || 'Total'}</span>
            <span class="font-mono">${formatSize(total)}</span>
          </div>`;
          return result;
        }
      },
      legend: {
        data: [t('usedSpace') || 'Used', t('freeSpace') || 'Free'],
        bottom: 0,
        textStyle: {
          color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#374151'
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '10%',
        top: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => formatSize(value)
        },
        splitLine: {
          lineStyle: {
            color: document.documentElement.classList.contains('dark') ? '#374151' : '#e5e7eb'
          }
        }
      },
      yAxis: {
        type: 'category',
        data: diskNames,
        axisLabel: {
          color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#374151',
          width: 100,
          overflow: 'truncate'
        }
      },
      series: [
        {
          name: t('usedSpace') || 'Used',
          type: 'bar',
          stack: 'total',
          emphasis: { focus: 'series' },
          data: usedData,
          itemStyle: { color: '#ef4444' } // Red for used
        },
        {
          name: t('freeSpace') || 'Free',
          type: 'bar',
          stack: 'total',
          emphasis: { focus: 'series' },
          data: freeData,
          itemStyle: { color: '#22c55e' } // Green for free
        }
      ]
    };

    chartInstance.current.setOption(option);
  };

  // Update chart on theme change
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (disks.length > 0) updateChart(disks);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [disks]);

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
            <HardDrive className="text-blue-500" />
            {t('diskOverview') || 'Disk Overview'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('diskOverviewDesc') || 'Overview of all connected drives and their usage'}</p>
        </div>
        <button
          onClick={fetchDiskStats}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
          title={t('refresh') || 'Refresh'}
        >
          <RefreshCw size={20} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 shrink-0">
          <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={18} />
          <p className="text-sm text-red-700 dark:text-red-400 break-all">{error}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">
        {/* Chart Section */}
        <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 min-h-[300px]">
          <div ref={chartRef} className="w-full h-full" />
        </div>

        {/* List Section */}
        <div className="w-full lg:w-80 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {disks.map((disk) => {
            const percentUsed = disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
            const isHighUsage = percentUsed > 90;
            
            return (
              <div 
                key={disk.mount_point}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <HardDrive size={18} className="text-gray-400" />
                    <span className="font-semibold text-gray-800 dark:text-gray-200 truncate max-w-[150px]" title={disk.mount_point}>
                      {disk.name || disk.mount_point}
                    </span>
                  </div>
                  <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", 
                    isHighUsage 
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" 
                      : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  )}>
                    {percentUsed.toFixed(1)}%
                  </span>
                </div>
                
                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 mb-3 overflow-hidden">
                  <div 
                    className={cn("h-2.5 rounded-full transition-all duration-500", 
                      isHighUsage ? "bg-red-500" : "bg-blue-500"
                    )} 
                    style={{ width: `${percentUsed}%` }}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500 block">{t('used') || 'Used'}</span>
                    <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{formatSize(disk.used)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 block">{t('free') || 'Free'}</span>
                    <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{formatSize(disk.available)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
