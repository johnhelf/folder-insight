import React from 'react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { formatSize, cn } from "../utils";

interface ChartViewProps {
  chartData: any[];
  t: (key: string, params?: Record<string, any>) => string;
  onDrillDown?: (item: any) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
  viewMode?: 'pie' | 'bar';
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

/**
 * 图表视图组件，支持环状图和柱状图
 */
export const ChartView: React.FC<ChartViewProps> = ({ 
  chartData, 
  t, 
  onDrillDown,
  onGoUp,
  canGoUp,
  viewMode = 'pie'
}) => {
  // 渲染环状图
  const renderPieChart = () => (
    <div className="w-full flex-1 flex flex-col md:flex-row items-center justify-around overflow-hidden">
      <div className="w-full md:w-1/2 h-full min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={80}
              outerRadius={120}
              paddingAngle={5}
              dataKey="value"
              onClick={(data) => onDrillDown?.(data)}
              style={{ cursor: 'pointer', outline: 'none' }}
              animationDuration={400}
              animationEasing="ease-out"
            >
              {chartData.map((_, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={COLORS[index % COLORS.length]} 
                  style={{ outline: 'none' }}
                />
              ))}
            </Pie>
            <RechartsTooltip 
              formatter={(value: any) => formatSize(Number(value || 0))}
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.96)',
                borderRadius: '8px',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                padding: '8px 12px'
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="w-full md:w-1/2 flex flex-col gap-2 overflow-auto max-h-full p-4">
        {chartData.map((item, index) => (
          <div 
            key={item.path || item.name} 
            className={cn(
              "flex items-center gap-3 p-2 rounded-lg transition-colors group",
              item.isDir ? "hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer" : ""
            )}
            onClick={() => item.isDir && onDrillDown?.(item)}
          >
            <div className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            <span className="flex-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {item.name}
            </span>
            <span className="text-xs font-mono text-gray-500 shrink-0">{item.formattedSize}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // 渲染柱状图
  const renderBarChart = () => (
    <div className="w-full flex-1 p-4 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
          <XAxis type="number" hide />
          <YAxis 
            dataKey="name" 
            type="category" 
            width={150} 
            fontSize={12}
            tick={(props) => {
              const { x, y, payload } = props;
              return (
                <g transform={`translate(${x},${y})`}>
                  <text
                    x={-10}
                    y={0}
                    dy={4}
                    textAnchor="end"
                    fill="currentColor"
                    className="text-xs opacity-70 fill-current"
                  >
                    {payload.value.length > 15 ? `${payload.value.substring(0, 12)}...` : payload.value}
                  </text>
                </g>
              );
            }}
          />
          <RechartsTooltip 
            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            formatter={(value: any) => formatSize(Number(value || 0))}
            contentStyle={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              borderRadius: '8px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              padding: '8px 12px'
            }}
          />
          <Bar 
            dataKey="value" 
            radius={[0, 4, 4, 0]}
            animationDuration={400}
            animationEasing="ease-out"
            onClick={(data) => {
              if (data && data.path) {
                onDrillDown?.(data);
              }
            }}
          >
            {chartData.map((_, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={COLORS[index % COLORS.length]} 
                className="cursor-pointer hover:opacity-80 transition-opacity"
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="p-4 md:p-8 h-full flex flex-col items-center relative">
      <div className="w-full flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-2">
          {canGoUp && (
            <button
              onClick={onGoUp}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-400"
              title={t('goUp')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t('topTitle')}</h3>
        </div>
      </div>
      
      {viewMode === 'pie' ? renderPieChart() : renderBarChart()}
    </div>
  );
};
