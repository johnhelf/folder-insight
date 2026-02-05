import React from 'react';
import { 
  Treemap as RechartsTreemap, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
} from "recharts";
import { formatSize } from "../utils";

interface TreemapViewProps {
  data: any[];
  t: (key: string, params?: Record<string, string>) => string;
  onDrillDown?: (item: any) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
}

const COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
];

const CustomizedContent = (props: any) => {
  const { x, y, width, height, index, name, isDir, onDrillDown, formattedSize } = props;

  // 这里的颜色加上透明度效果，如果是目录则深一点
  const baseColor = COLORS[index % COLORS.length];
  
  // 只有宽度和高度足够大时才显示文字
  const showText = width > 40 && height > 20;
  const fontSize = Math.max(9, Math.min(width / 10, 13));

  return (
    <g 
      onClick={() => isDir && onDrillDown?.(props)}
      style={{ cursor: isDir ? 'pointer' : 'default' }}
      className="group"
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        ry={6}
        className="transition-all duration-300"
        style={{
          fill: baseColor,
          stroke: '#fff',
          strokeWidth: 2,
          opacity: 0.9,
        }}
      />
      {/* Hover 效果叠加层 */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        ry={4}
        fill="#fff"
        style={{
          opacity: 0,
          pointerEvents: 'none'
        }}
        className="group-hover:opacity-10 transition-opacity duration-200"
      />
      
      {showText && (
        <foreignObject x={x + 4} y={y + 4} width={width - 8} height={height - 8}>
          <div 
            className="w-full h-full flex flex-col justify-center items-center overflow-hidden pointer-events-none"
            style={{ color: '#fff' }}
          >
            <span 
              className="w-full text-center font-bold leading-tight break-all line-clamp-2"
              style={{ fontSize: `${fontSize}px` }}
            >
              {name}
            </span>
            {height > 40 && (
              <span 
                className="w-full text-center opacity-80 mt-0.5"
                style={{ fontSize: `${fontSize * 0.85}px` }}
              >
                {formattedSize}
              </span>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
};

export const TreemapView: React.FC<TreemapViewProps> = ({ 
  data, 
  t, 
  onDrillDown,
  onGoUp,
  canGoUp
}) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 italic">
        {t('noData')}
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col overflow-hidden">
      <div className="w-full flex items-center justify-between mb-4 shrink-0">
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
          <h3 className="text-lg font-semibold">{t('treemapTitle')}</h3>
        </div>
      </div>
      
      <div className="flex-1 w-full overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsTreemap
            data={data}
            dataKey="value"
            aspectRatio={4 / 3}
            stroke="#fff"
            fill="#8884d8"
            animationDuration={400}
            animationEasing="ease-out"
            content={<CustomizedContent onDrillDown={onDrillDown} />}
          >
            <RechartsTooltip 
              formatter={(value: any) => formatSize(Number(value || 0))}
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.96)',
                borderRadius: '8px',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
            />
          </RechartsTreemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
