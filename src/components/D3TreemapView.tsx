import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { EChartsNode } from '../chartHelpers';
import { formatSize } from '../utils';

interface D3TreemapViewProps {
  data: EChartsNode | null;
  isRTL?: boolean;
  onDrillDown?: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent | MouseEvent, path: string) => void;
}

export const D3TreemapView: React.FC<D3TreemapViewProps> = ({
  data,
  isRTL = false,
  onDrillDown,
  onContextMenu
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoverNode, setHoverNode] = useState<d3.HierarchyRectangularNode<EChartsNode> | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (tooltipRef.current && containerRef.current) {
      const tooltip = tooltipRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Determine quadrant
      const isTop = y < rect.height / 2;
      const isLeft = x < rect.width / 2;

      // Position in opposite corner
      // If mouse is Top-Left, tooltip goes Bottom-Right
      tooltip.style.top = isTop ? 'auto' : '1rem';
      tooltip.style.bottom = isTop ? '1rem' : 'auto';
      tooltip.style.left = isLeft ? 'auto' : '1rem';
      tooltip.style.right = isLeft ? '1rem' : 'auto';
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Detect dark mode changes
  useEffect(() => {
    const checkDarkMode = () => {
      // Check if 'dark' class is present on html/body (Tailwind class strategy)
      const hasDarkClass = document.documentElement.classList.contains('dark');
      // Check system preference (Tailwind media strategy)
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      // If explicit class exists, use it. Otherwise fall back to system preference.
      // This covers both 'class' and 'media' strategies.
      setIsDarkMode(hasDarkClass || (prefersDark && !document.documentElement.classList.contains('light')));
    };

    // Initial check
    checkDarkMode();

    // Observer for class changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Listener for system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => checkDarkMode();
    mediaQuery.addEventListener('change', handler);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handler);
    };
  }, []);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    // Use dimensions from state if available, otherwise fallback to current size
    const width = dimensions.width || containerRef.current.clientWidth;
    const height = dimensions.height || containerRef.current.clientHeight;

    if (width === 0 || height === 0) return;

    // Clear previous
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("font", "12px sans-serif")
      .append("g");

    const hierarchy = d3.hierarchy(data)
      .sum(d => (d.children && d.children.length > 0) ? 0 : d.value)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const treemap = d3.treemap<EChartsNode>()
      .size([width, height])
      .paddingTop(22)
      .paddingRight(2)
      .paddingBottom(2)
      .paddingLeft(2)
      .paddingInner(1)
      .round(true);

    const root = treemap(hierarchy);

    // Optimized Color Palette with Dark/Light Mode Support
    // Light Mode: Professional, muted cool tones (Business/Corporate feel).
    // Avoids bright yellows/reds/neon greens.
    const refinedLight = [
        "#94a3b8", // slate-400
        "#9ca3af", // gray-400
        "#a1a1aa", // zinc-400
        "#60a5fa", // blue-400
        "#818cf8", // indigo-400
        "#a78bfa", // violet-400
        "#c084fc", // purple-400
        "#2dd4bf", // teal-400
        "#38bdf8", // sky-400
    ];

    // Dark Mode: Adjusted to be less "deep/dull", slightly more vibrant but still dark-theme appropriate
    const refinedDark = [
        "#475569", // slate-600 (was 700)
        "#4b5563", // gray-600 (was 700)
        "#52525b", // zinc-600 (was 700)
        "#2563eb", // blue-600 (was 800)
        "#4f46e5", // indigo-600 (was 800)
        "#7c3aed", // violet-600 (was 800)
        "#9333ea", // purple-600 (was 800)
        "#0d9488", // teal-600 (was 800)
        "#0284c7", // sky-600 (was 800)
    ];

    const currentPalette = isDarkMode ? refinedDark : refinedLight;

    const topLevelCategories = (root.children || []).map(d => d.data.name);
    const colorScale = d3.scaleOrdinal(currentPalette)
        .domain(topLevelCategories);

    const getNodeColor = (d: d3.HierarchyRectangularNode<EChartsNode>) => {
        // Find depth 1 ancestor to keep color consistent within a folder
        const ancestor = d.ancestors().find(n => n.depth === 1);
        // Fallback to own name if depth 1 (it is the ancestor) or root
        const key = ancestor ? ancestor.data.name : d.data.name;
        return colorScale(key);
    };

    // Render nodes
    // We render all nodes to show hierarchy borders
    // Optimization: Filter out very small rectangles (less than 3x3 pixels) to significantly improve performance
    // 优化：过滤掉非常小的矩形（小于 1x1 像素），大幅提升渲染性能
    // Optimization: Filter out very small rectangles (less than 1x1 pixels)
    const cell = g.selectAll("g")
      .data(root.descendants().filter(d => (d.x1 - d.x0) > 1 && (d.y1 - d.y0) > 1))
      .join("g")
      .attr("transform", d => `translate(${d.x0},${d.y0})`);

    // Rects
    cell.append("rect")
      .attr("width", d => Math.max(0, d.x1 - d.x0))
      .attr("height", d => Math.max(0, d.y1 - d.y0))
      .attr("fill", d => {
          // Parents: Distinct background color to separate from app background
          // Use slightly transparent white/black to blend but stay distinct
          if (d.children) return isDarkMode ? "#111827" : "#ffffff"; 
          return getNodeColor(d);
      })
      .attr("fill-opacity", d => d.children ? 0.5 : 0.9) // Parents semi-transparent to show nesting depth
      .attr("stroke", isDarkMode ? "#000000" : "#e2e8f0") // Darker borders for dark mode, subtle for light
      .attr("stroke-width", d => d.children ? 2 : 1) // Thicker border for parents
      .attr("rx", 4) // Rounded corners for a modern feel
      .attr("ry", 4)
      .style("cursor", d => d.children ? "default" : "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        if (d.data.isDir && onDrillDown) {
            onDrillDown(d.data.path);
        }
      })
      .on("mouseover", (event, d) => {
        event.stopPropagation();
        setHoverNode(d);
        if (!d.children) {
             d3.select(event.currentTarget).attr("fill-opacity", 1);
        }
      })
      .on("mouseout", (event, d) => {
        event.stopPropagation();
        setHoverNode(null);
        if (!d.children) {
             d3.select(event.currentTarget).attr("fill-opacity", 0.9);
        }
      })
      .on("contextmenu", (event, d) => {
        event.stopPropagation();
        if (onContextMenu) {
          // Pass the event and the path of the clicked node
          onContextMenu(event, d.data.path);
        }
      });

    // Titles for parents (the top padding area)
    const parentCells = cell.filter(d => !!d.children);
    
    parentCells.each(function(d, i) {
        const node = d3.select(this);
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;
        
        // Skip label if parent box is too small
        if (width < 50 || height < 20) return;

        // Use a unique ID for clipPath
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const clipId = `clip-parent-${i}-${uniqueId}`;

        // Add clipPath
        node.append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("width", Math.max(0, width))
            .attr("height", Math.max(0, height));

        node.append("text")
            .attr("clip-path", `url(#${clipId})`)
            .attr("x", 4)
            .attr("y", 14)
            .text(d.data.name)
            .attr("font-size", "10px")
            .attr("font-weight", "bold")
            .attr("text-anchor", isRTL ? "end" : "start")
            .attr("fill", "currentColor")
            .attr("class", "text-gray-500 dark:text-gray-400") // Muted text for parents
            .style("pointer-events", "none");
    });
    
    // Labels for leaves (if space permits)
    // Only show labels for top levels to avoid clutter
    // 仅显示顶层的标签以避免混乱
    // 增加尺寸限制，太小的区块不显示文字 (width > 60, height > 30)
    // Increase size limit, do not show text for blocks that are too small
    const textCells = cell.filter(d => !d.children && d.depth <= 2 && (d.x1 - d.x0) > 40 && (d.y1 - d.y0) > 20);
    
    textCells.each(function(d, i) {
        const node = d3.select(this);
        // Use a unique ID that handles non-ASCII characters and avoids collisions
        const uniqueId = Math.random().toString(36).substr(2, 9);
        const clipId = `clip-${i}-${uniqueId}`;
        const width = d.x1 - d.x0;
        const height = d.y1 - d.y0;

        // Estimate text width (approx 7px per char for 12px font)
        const estimatedTextWidth = d.data.name.length * 8; // Conservative estimate

        // Strict hiding: if text is significantly wider than box, don't show
        // 严格隐藏：如果文字明显宽于方块，则不显示
        // 并且对小方块增加更严格的限制 (width > 60, height > 25)
        if (width < 60 || height < 25 || estimatedTextWidth > width + 10) {
             return; 
        }

        // Add clipPath to ensure text stays within the rect
        node.append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("width", Math.max(0, width))
            .attr("height", Math.max(0, height));

        node.append("text")
            .attr("clip-path", `url(#${clipId})`)
            .attr("x", 4)
            .attr("y", 16) // Adjusted for larger font
            .text(d.data.name)
            .attr("font-size", "13px") // Restored/Increased size
            .attr("font-weight", "500")
            .attr("text-anchor", isRTL ? "end" : "start")
            // Contrast text color: Dark text for light mode (pastels), Light text for dark mode (deep colors)
            .attr("fill", isDarkMode ? "#f1f5f9" : "#1e293b") // slate-100 (Dark Mode) / slate-800 (Light Mode)
            .style("pointer-events", "none"); // Ensure text doesn't block mouse events
    });

  }, [data, isDarkMode, dimensions, isRTL]); // Re-run when dark mode or dimensions change

  return (
    <div 
      className="flex-1 min-h-0 relative w-full h-full" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
    >
      <svg ref={svgRef} width="100%" height="100%"></svg>

      {/* Smart Tooltip Overlay - Fixed Corner */}
      <div 
          ref={tooltipRef}
          className="absolute pointer-events-none bg-slate-900/60 text-white text-xs p-3 rounded-lg z-50 whitespace-normal shadow-xl border border-slate-700/50 backdrop-blur-xl backdrop-saturate-150"
          style={{
              display: hoverNode ? 'block' : 'none',
              maxWidth: '320px',
              transition: 'all 0.15s ease-out'
          }}
      >
          {hoverNode && (
            <div className="flex flex-col gap-1">
              <div className="font-bold text-amber-400 text-sm truncate border-b border-slate-700 pb-1 mb-1">{hoverNode.data.name}</div>
              <div className="flex justify-between items-center text-gray-300">
                <span>Size:</span>
                <span className="font-mono text-white">{formatSize(hoverNode.value || 0)}</span>
              </div>
              {hoverNode.depth > 0 && (
                <div className="text-gray-500 mt-1 text-[10px] break-all leading-tight bg-slate-800/50 p-1 rounded">
                  {hoverNode.data.path}
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
};
