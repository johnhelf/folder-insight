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
  const [hoverNode, setHoverNode] = useState<d3.HierarchyRectangularNode<EChartsNode> | null>(null);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    // Maximize chart size (0.98 padding)
    const radius = Math.min(width, height) / 2 * 0.98;

    // Clear previous
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg
      .attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`)
      .style("font", "12px sans-serif")
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
    const effectiveLayers = Math.min(Math.max(root.height, 1), 7);
    
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
    const path = g.append("g")
      .selectAll("path")
      // Show up to 7 levels as requested
      .data(root.descendants().filter(d => d.depth <= 7))
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
        } else if (d.depth > 0 && d.data.isDir && onDrillDown) {
            onDrillDown(d.data.path);
        }
      })
      .on("mouseover", (event, d) => {
        setHoverNode(d);
        d3.select(event.currentTarget).attr("fill-opacity", 1);
      })
      .on("mouseout", (event, d) => {
        setHoverNode(null);
        if (d.depth > 0) {
            d3.select(event.currentTarget).attr("fill-opacity", 1 - (d.depth * 0.08));
        }
      });

    // Add titles (native tooltip)
    path.append("title")
      .text(d => `${d.ancestors().map(d => d.data.name).reverse().join("/")}\n${formatSize(d.value || 0)}`);

    // --- Internal Labels (Rotated) ---
    // Only label nodes with sufficient angular width
    g.append("g")
        .attr("pointer-events", "none")
        .selectAll("text")
        .data(root.descendants().filter(d => d.depth > 0 && (d.x1 - d.x0) > 0.06)) // ~3.5 degrees
        .join("text")
        .attr("transform", function(d) {
            const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
            // y is unused, removed
            // const y = (d.y0 + d.y1) / 2; 
            // Actually, arc.centroid returns [x, y] in Cartesian.
            // But for rotation we need angle.
            const c = arc.centroid(d);
            const rotate = x - 90;
            // If angle is in bottom half (90 to 270), rotate 180 to be readable
            const finalRotate = (x > 90 && x < 270) ? rotate + 180 : rotate;
            return `translate(${c[0]},${c[1]}) rotate(${finalRotate})`;
        })
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "11px")
        .attr("fill", "#333") // Dark text for visibility on light/colored background
        // Ideally adapt to background brightness, but standard dark grey is usually safe on pastel/saturated colors
        // Except for very dark segments.
        .style("text-shadow", "0 0 2px white") // Halo for readability
        .text(d => {
            // Check arc length at inner radius
            const innerR = radius * (0.15 + (d.depth - 1) * 0.12);
            const arcLen = (d.x1 - d.x0) * innerR;
            // Approx 6px per char
            const maxChars = Math.floor(arcLen / 6);
            if (maxChars < 3) return "";
            return d.data.name.length > maxChars ? d.data.name.slice(0, maxChars) + ".." : d.data.name;
        });

  }, [data, canGoUp]);

  return (
    <div className="flex-1 min-h-0 relative w-full h-full" ref={containerRef}>
      <svg ref={svgRef} width="100%" height="100%"></svg>
      
      {/* Custom Tooltip Overlay */}
      {hoverNode && (
          <div 
              className="absolute pointer-events-none bg-black/80 text-white text-xs p-2 rounded z-10 whitespace-pre"
              style={{
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center'
              }}
          >
              <div className="font-bold mb-1">{hoverNode.data.name}</div>
              <div>{formatSize(hoverNode.value || 0)}</div>
              {hoverNode.depth > 0 && <div className="text-gray-400 mt-1 text-[10px]">{hoverNode.data.path}</div>}
          </div>
      )}
    </div>
  );
};
