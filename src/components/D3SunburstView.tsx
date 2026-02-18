import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { EChartsNode } from '../chartHelpers';
import { formatSize } from '../utils';

interface D3SunburstViewProps {
  data: EChartsNode | null;
  t?: (key: string, params?: Record<string, any>) => string;
  onDrillDown?: (path: string) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
}

export const D3SunburstView: React.FC<D3SunburstViewProps> = ({
  data,
  onDrillDown,
  onGoUp,
  canGoUp
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoverNode, setHoverNode] = useState<d3.HierarchyRectangularNode<EChartsNode> | null>(null);

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

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    // Use dimensions from state if available, otherwise fallback to current size
    const width = dimensions.width || containerRef.current.clientWidth;
    const height = dimensions.height || containerRef.current.clientHeight;
    
    if (width === 0 || height === 0) return;

    // Maximize chart size (aggressive fit)
    // We want to leave about 5% padding on top/bottom
    // So 0.5 * 0.9 = 0.45 (which is 90% of the half-height, i.e., 5% margin on each side)
    const radius = Math.min(width, height) * 0.45;

    // Clear previous
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg
      .attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`)
      .style("font", "12px 'SimHei', 'Microsoft YaHei', sans-serif")
      .append("g");

    const hierarchy = d3.hierarchy(data)
      .sum(d => (d.children && d.children.length > 0) ? 0 : d.value)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Create partition layout
    const partition = d3.partition<EChartsNode>()
      .size([2 * Math.PI, radius]);

    const root = partition(hierarchy);

    // Color scale - Use consistent coloring logic with Treemap
    // Map top-level (Depth 1) categories to distinct colors
    const topLevelCategories = (root.children || []).map(d => d.data.name);
    // Use a large categorical palette
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10)
        .domain(topLevelCategories);

    const getNodeColor = (d: d3.HierarchyRectangularNode<EChartsNode>) => {
        if (d.depth === 0) return "transparent";
        // Find depth 1 ancestor to keep color consistent within a sector
        const ancestor = d.ancestors().find(n => n.depth === 1);
        const key = ancestor ? ancestor.data.name : d.data.name;
        return colorScale(key);
    };

    // Arc generator
    // Adjust ring widths to fit available layers dynamically
    // 动态调整圆环宽度以适应层级数量
    
    // Limit max layers to consider for width calculation (don't make them too thin if depth > 7)
    // 限制最大层数计算 (如果深度 > 7，不让层级变得过薄)
    // Fix: Use fixed layer count (7) to ensure consistent ring width and avoid visual jumping during navigation
    // 修复：使用固定层数（7），确保圆环宽度一致，避免导航时的视觉跳动
    const effectiveLayers = 7;
    
    // Available radius from 15% to 100% = 85%
    const layerWidth = 0.85 / effectiveLayers;

    const arc = d3.arc<d3.HierarchyRectangularNode<EChartsNode>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius(d => {
        if (d.depth === 0) return 0; // Center
        if (d.depth === 1) return radius * 0.15; // Gap
        // Dynamic width
        return radius * (0.15 + (d.depth - 1) * layerWidth);
      })
      .outerRadius(d => {
        if (d.depth === 0) return radius * 0.10; // Center
        // Dynamic width
        return radius * (0.15 + (d.depth) * layerWidth) - 1;
      });

    // Draw arcs
    g.append("g")
      .selectAll("path")
      // Show up to 7 levels as requested
      // Optimization: Filter out very small arcs (less than 0.005 radians) to improve performance
      // 优化：过滤掉非常小的扇区（小于 0.005 弧度），以减少 DOM 节点数量，解决 Linux 下的卡顿问题
      .data(root.descendants().filter(d => d.depth <= 7 && (d.x1 - d.x0) > 0.005))
      .join("path")
      .attr("fill", d => getNodeColor(d))
      .attr("fill-opacity", d => {
        if (d.depth === 0) return 1;
        // Fade out slightly for deeper levels to show depth
        return 1 - (d.depth * 0.08); // 0.92, 0.84, etc.
      })
      .attr("d", arc)
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        if (d.depth === 0 && canGoUp && onGoUp) {
            onGoUp();
        } else if (d.depth > 0 && d.data.isDir && onDrillDown && d.data.path) {
            onDrillDown(d.data.path);
        }
      })
      .on("mouseout", (event, d) => {
        setHoverNode(null);
        if (d.depth > 0) {
            d3.select(event.currentTarget).attr("fill-opacity", 1 - (d.depth * 0.08));
        }
      })
      .on("mouseover", (event, d) => {
        setHoverNode(d);
        d3.select(event.currentTarget).attr("fill-opacity", 1);
      });

    // --- External Labels with Lines (Spider Labels) ---
    // Only label visible nodes with sufficient angular width, primarily leaves or outer-most
    const labelThreshold = 0.02; // Reduced threshold (approx 1.1 degrees) to show more labels
    
    // Helper to check if a node has any children that are large enough to be labeled
    const hasLabelableChildren = (d: d3.HierarchyRectangularNode<EChartsNode>) => {
        if (!d.children || d.children.length === 0) return false;
        return d.children.some(c => (c.x1 - c.x0) > labelThreshold);
    };

    const labelData = root.descendants().filter(d => {
        // Skip root and center
        if (d.depth === 0) return false;
        // Only visible layers
        if (d.depth > 7) return false;
        // Only large enough arcs
        if ((d.x1 - d.x0) < labelThreshold) return false;
        
        // Priority logic:
        // 1. Inner rings are prioritized (allow more labels or looser constraints?)
        // 2. For each parent, only show the top N largest children.
        
        const parent = d.parent;
        if (parent && parent.children) {
            // Find rank among siblings based on value (size)
            // Note: children are already sorted by value in d3.hierarchy setup if we used .sort()
            // but let's be safe and find index in the current sorted children array
            const siblings = parent.children; // Assuming this array is sorted by value descending
            const rank = siblings.indexOf(d);
            
            // Define max labels per parent based on depth
            // Inner rings (depth 1, 2) get more slots. Outer rings get fewer.
            let maxLabelsPerParent = 3;
            if (d.depth === 1) maxLabelsPerParent = 10;
            else if (d.depth === 2) maxLabelsPerParent = 5;
            
            if (rank >= maxLabelsPerParent) return false;
        }

        // Show label if:
        // 1. It is a leaf node (no children)
        // 2. OR it is effectively a leaf for labeling purposes (no children big enough to be labeled)
        // 3. OR it is at the max depth of the view
        // This ensures that large groups of small files get a label at the parent folder level
        return !hasLabelableChildren(d) || d.depth === 7;
    });

    const labelGroup = g.append("g")
        .attr("pointer-events", "none")
        .classed("labels", true);
        
    const linesGroup = g.append("g")
        .attr("pointer-events", "none")
        .classed("lines", true);

    // Arc for label positioning (just outside the chart)
    const labelArc = d3.arc<d3.HierarchyRectangularNode<EChartsNode>>()
        .innerRadius(radius * 1.01)
        .outerRadius(radius * 1.01)
        .startAngle(d => d.x0)
        .endAngle(d => d.x1);

    // Compute positions with collision avoidance
    const labels = labelData.map(d => {
        const pos = labelArc.centroid(d);
        const midAngle = (d.x0 + d.x1) / 2;
        // True if right side
        const isRight = Math.cos(midAngle - Math.PI / 2) > 0;
        
        // Base x/y
        // We push labels to the far left/right
        const x = radius * 1.03 * (isRight ? 1 : -1);
        const y = pos[1];
        
        // Priority for label placement relaxation:
        // Lower depth (closer to root) = Higher priority (should move less, or displace others)
        // Larger arc = Higher priority
        const priority = (10 - d.depth) * 100 + (d.x1 - d.x0) * 1000;

        return {
            node: d,
            x,
            y,
            isRight,
            posA: arc.centroid(d), // Inner anchor
            posB: pos, // Outer anchor (pre-adjustment)
            priority
        };
    });

    // Simple 1D collision detection on y-axis for left and right groups independently
    const relaxLabels = (items: typeof labels) => {
        const spacing = 11; // Slightly looser to avoid clutter
        // Sort by y to establish initial order
        items.sort((a, b) => a.y - b.y);
        
        // Constrain within height limits to prevent cutoff
        const maxY = height / 2 - 10;
        const minY = -height / 2 + 10;
        
        // Iterative relaxation
        for(let k=0; k<5; k++) {
            for (let i = 0; i < items.length - 1; i++) {
                const a = items[i];
                const b = items[i+1];
                if (b.y - a.y < spacing) {
                    const overlap = spacing - (b.y - a.y);
                    
                    // Distribute overlap based on priority? 
                    // Or just push apart equally for simplicity, as priority was used for selection.
                    // Let's stick to equal push for stability, but maybe bias if we wanted.
                    // For now, equal push.
                    a.y -= overlap / 2;
                    b.y += overlap / 2;
                }
            }
            // Clamp to view bounds immediately
            for (let item of items) {
                 if (item.y > maxY) item.y = maxY;
                 if (item.y < minY) item.y = minY;
            }
        }
    };

    const leftLabels = labels.filter(l => !l.isRight);
    const rightLabels = labels.filter(l => l.isRight);
    
    relaxLabels(leftLabels);
    relaxLabels(rightLabels);

    // Draw lines
    linesGroup.selectAll("polyline")
        .data(labels)
        .join("polyline")
        .attr("points", d => {
            const posA = d.posA;
            const posB = d.posB; // Original outer anchor
            const posC = [d.x, d.y]; // Adjusted label position
            
            return [posA, posB, posC].map(p => p.join(",")).join(" ");
        })
        .attr("fill", "none")
        .attr("stroke", "currentColor")
        .attr("stroke-width", "1px")
        .attr("opacity", 0.35);

    // Draw text
    labelGroup.selectAll("text")
        .data(labels)
        .join("text")
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .attr("dy", "0.35em")
        .style("text-anchor", d => d.isRight ? "start" : "end")
        .text(d => {
            const name = d.node.data.name;
            return name.length > 20 ? name.slice(0, 18) + "..." : name;
        })
        .attr("fill", "currentColor")
        .style("font-size", "11px");

  }, [data, canGoUp]);

  return (
    <div 
      className="flex-1 min-h-0 relative w-full h-full" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
    >
      <svg ref={svgRef} width="100%" height="100%"></svg>
      
      {/* Smart Tooltip Overlay - Fixed Corner */}
      {/* 始终显示在鼠标位置的对角，避免遮挡内容和被边缘裁切 */}
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
