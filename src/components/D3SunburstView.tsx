import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { EChartsNode } from '../chartHelpers';
import { formatSize } from '../utils';

interface D3SunburstViewProps {
  data: EChartsNode | null;
  t?: (key: string, params?: Record<string, any>) => string;
  onDrillDown?: (path: string) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
  onContextMenu?: (e: React.MouseEvent | MouseEvent, path: string) => void;
}

export const D3SunburstView: React.FC<D3SunburstViewProps> = ({
  data,
  onDrillDown,
  onGoUp,
  canGoUp,
  onContextMenu
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoverNode, setHoverNode] = useState<d3.HierarchyRectangularNode<EChartsNode> | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Reset hover node when data changes (e.g. drill down)
  useEffect(() => {
      setHoverNode(null);
  }, [data]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const processedHierarchy = useMemo(() => {
    if (!data) return null;
    const root = d3.hierarchy(data)
        .sum(d => (d.children && d.children.length > 0) ? 0 : d.value)
        .sort((a, b) => (b.value || 0) - (a.value || 0));
    return root;
  }, [data]);

  const colorScale = useMemo(() => {
      if (!processedHierarchy) return d3.scaleOrdinal(d3.schemeTableau10);
      const topLevelCategories = (processedHierarchy.children || []).map(d => d.data.name);
      return d3.scaleOrdinal(d3.schemeTableau10).domain(topLevelCategories);
  }, [processedHierarchy]);

  const getNodeColor = useCallback((d: d3.HierarchyRectangularNode<EChartsNode>) => {
      if (d.depth === 0) return "transparent";
      if (d.data.name.startsWith("其他") || d.data.name.startsWith("Other")) return "#e0e0e0";
      const ancestor = d.ancestors().find(n => n.depth === 1);
      const key = ancestor ? ancestor.data.name : d.data.name;
      return colorScale(key);
  }, [colorScale]);

  // Main Chart Effect
  useEffect(() => {
    if (!processedHierarchy || !svgRef.current || !containerRef.current) return;

    const width = dimensions.width || containerRef.current.clientWidth;
    const height = dimensions.height || containerRef.current.clientHeight;
    
    if (width === 0 || height === 0) return;

    // Layout: Chart on left (30%), Labels on right
    const chartCenterX = width * 0.35;
    const chartCenterY = height * 0.5;
    // Radius logic
    const radius = Math.min(width * 0.6, height * 0.9) / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear all

    const g = svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("font", "12px 'SimHei', 'Microsoft YaHei', sans-serif")
      .append("g")
      .attr("transform", `translate(${chartCenterX}, ${chartCenterY})`);

    const partition = d3.partition<EChartsNode>()
      .size([2 * Math.PI, radius]);

    const root = partition(processedHierarchy);

    // Arc Config
    // Dynamically calculate effectiveLayers to auto-scale
    const maxDepth = processedHierarchy.height + 1;
    const effectiveLayers = Math.max(maxDepth, 2); 
    const layerWidth = 0.9 / effectiveLayers; 

    const arc = d3.arc<d3.HierarchyRectangularNode<EChartsNode>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius(d => {
        if (d.depth === 0) return 0;
        if (d.depth === 1) return radius * 0.15;
        return radius * (0.15 + (d.depth - 1) * layerWidth);
      })
      .outerRadius(d => {
        if (d.depth === 0) return radius * 0.10;
        return radius * (0.15 + (d.depth) * layerWidth) - 1;
      });

    // Draw Arcs
    const displayThreshold = 0.005; 
    
    const arcGroup = g.append("g");
    
    arcGroup.selectAll("path")
      .data(root.descendants().filter(d => d.depth <= 7 && (d.x1 - d.x0) > displayThreshold))
      .join("path")
      .attr("class", "sector")
      .attr("fill", d => getNodeColor(d))
      .attr("fill-opacity", d => d.depth === 0 ? 0 : 1 - (d.depth * 0.05))
      .attr("d", arc)
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        if (d.depth === 0 && canGoUp && onGoUp) {
            onGoUp();
        } else if (d.depth > 0 && d.data.isDir && onDrillDown && d.data.path) {
            onDrillDown(d.data.path);
        }
      })
      .on("mouseover", (event, d) => {
        setHoverNode(d);
        d3.select(event.currentTarget)
          .attr("stroke", "#fff")
          .attr("stroke-width", 2)
          .attr("fill-opacity", 1);
      })
      .on("mouseout", (event, d) => {
        setHoverNode(null);
        d3.select(event.currentTarget)
          .attr("stroke", null)
          .attr("stroke-width", null)
          .attr("fill-opacity", d.depth === 0 ? 0 : 1 - (d.depth * 0.05));
      })
      .on("contextmenu", (event, d) => {
        event.stopPropagation();
        if (onContextMenu) {
          let path = d.data.path;
          if (!path || d.data.name.startsWith("其他") || d.data.name.startsWith("Others")) {
             if (d.parent && d.parent.data.path) {
                 path = d.parent.data.path;
             }
          }
          if (path) {
            onContextMenu(event, path);
          }
        }
      });

    // --- Texture for "Other" nodes ---
    const otherNodes = root.descendants().filter(d => 
      (d.data.name.startsWith("其他") || d.data.name.startsWith("Others")) &&
      (d.x1 - d.x0) > displayThreshold
    );

    const textureGroup = g.append("g").attr("pointer-events", "none").attr("opacity", 0.3);

    otherNodes.forEach(d => {
       const innerR = arc.innerRadius()(d);
       const outerR = arc.outerRadius()(d);
       const startA = d.x0;
       const endA = d.x1;
       
       // Draw radial lines
       // Calculate circumference at innerR
       const circ = innerR * (endA - startA);
       // We want lines every ~3px
       const count = Math.floor(circ / 3);
       const step = (endA - startA) / Math.max(count, 5); 

       for (let a = startA + step/2; a < endA; a += step) {
           const x1 = innerR * Math.sin(a);
           const y1 = -innerR * Math.cos(a);
           const x2 = outerR * Math.sin(a);
           const y2 = -outerR * Math.cos(a);
           
           textureGroup.append("line")
             .attr("x1", x1)
             .attr("y1", y1)
             .attr("x2", x2)
             .attr("y2", y2)
             .attr("stroke", "#000")
             .attr("stroke-width", 0.5);
       }
    });

    // Layer for Labels
    g.append("g").attr("class", "label-layer");

  }, [processedHierarchy, canGoUp, dimensions, getNodeColor, onDrillDown, onGoUp, onContextMenu]);

  // Effect: Handle Labels on Hover
  useEffect(() => {
     if (!svgRef.current || !processedHierarchy || !dimensions.width) return;

     const svg = d3.select(svgRef.current);
     const labelLayer = svg.select(".label-layer");
     const width = dimensions.width;
     const height = dimensions.height;
     const radius = Math.min(width * 0.6, height * 0.9) / 2;

     // Clear previous labels
     labelLayer.selectAll("*").remove();

     if (!hoverNode) return;

     // Determine targets:
     // If hovered node has children, show them.
     // If hovered node is leaf, show it.
     let targets = hoverNode.children;
     if (!targets || targets.length === 0) {
         targets = [hoverNode];
     }

     // Filter and Sort
     const displayThreshold = 0.005;
     const visibleTargets = targets.filter(d => (d.x1 - d.x0) > displayThreshold);
     
     // Sort by angle (x0) to maintain order from top-clockwise
     visibleTargets.sort((a, b) => a.x0 - b.x0);

     // Layout Constants
     const labelAreaX = radius + 40; // Start of label area (relative to center)
     const rowHeight = 24;
     const maxRows = Math.floor(height / rowHeight);
     
     // Limit number of labels to avoid overflow
     const itemsToShow = visibleTargets.slice(0, maxRows);

     // Calculate startY to center the list vertically
     const totalListHeight = itemsToShow.length * rowHeight;
     const startY = -totalListHeight / 2;

     // Helper to get centroid
     const maxDepth = processedHierarchy.height + 1;
     const effectiveLayers = Math.max(maxDepth, 2); 
     const layerWidth = 0.9 / effectiveLayers; 
     const getInnerR = (d: any) => {
        if (d.depth === 0) return 0;
        if (d.depth === 1) return radius * 0.15;
        return radius * (0.15 + (d.depth - 1) * layerWidth);
      };
      const getOuterR = (d: any) => {
         if (d.depth === 0) return radius * 0.10;
        return radius * (0.15 + (d.depth) * layerWidth) - 1;
      };

      const getCentroid = (d: any) => {
          const innerR = getInnerR(d);
          const outerR = getOuterR(d);
          const r = (innerR + outerR) / 2;
          const angle = (d.x0 + d.x1) / 2;
          return [r * Math.sin(angle), -r * Math.cos(angle)];
      };

     // Draw Connectors
     itemsToShow.forEach((d, i) => {
         const [cx, cy] = getCentroid(d);
         const ly = startY + i * rowHeight + rowHeight/2;
         const lx = labelAreaX; // Left edge of text area

         // Draw path
         // M cx,cy -> C ... -> L lx, ly
         // Control points for smooth curve
         const c1x = cx + (lx - cx) / 2;
         const c1y = cy;
         const c2x = cx + (lx - cx) / 2;
         const c2y = ly;

         labelLayer.append("path")
            .attr("d", `M${cx},${cy} C${c1x},${c1y} ${c2x},${c2y} ${lx},${ly}`)
            .attr("fill", "none")
            .attr("stroke", getNodeColor(d))
            .attr("stroke-width", 1)
            .attr("opacity", 0.6);
            
         // Draw Circle at target
         labelLayer.append("circle")
            .attr("cx", lx)
            .attr("cy", ly)
            .attr("r", 3)
            .attr("fill", getNodeColor(d));
            
         // Draw Text
         const textGroup = labelLayer.append("g")
            .attr("transform", `translate(${lx + 10}, ${ly})`);
            
         textGroup.append("text")
            .text(d.data.name.length > 25 ? d.data.name.slice(0, 22) + "..." : d.data.name)
            .attr("dy", "0.35em")
            .style("font-size", "13px")
            .style("font-weight", "bold")
            .style("fill", "currentColor"); // Use CSS color (slate-600/300)
            
         textGroup.append("text")
            .text(formatSize(d.value || 0))
            .attr("dy", "0.35em")
            .attr("x", 200) // Fixed width for name
            .attr("text-anchor", "end")
            .style("font-size", "12px")
            .style("font-family", "monospace")
            .style("fill", "currentColor")
            .style("opacity", 0.7);
     });

  }, [hoverNode, dimensions, processedHierarchy, getNodeColor]);

  return (
    <div 
      className="flex-1 min-h-0 relative w-full h-full text-slate-600 dark:text-slate-300" 
      ref={containerRef}
    >
      <svg ref={svgRef} width="100%" height="100%"></svg>
      
      {/* Floating Tooltip for mouse-over (still useful for quick info) */}
      <div 
          ref={tooltipRef}
          className="absolute pointer-events-none bg-slate-900/90 text-white text-xs p-2 rounded z-50 whitespace-nowrap shadow-lg border border-slate-700"
          style={{
              display: hoverNode ? 'block' : 'none',
              top: '1rem',
              right: '1rem',
              transition: 'opacity 0.2s'
          }}
      >
          {hoverNode && (
            <div>
              <span className="font-bold text-amber-400">{hoverNode.data.name}</span>
              <span className="mx-2">|</span>
              <span className="font-mono">{formatSize(hoverNode.value || 0)}</span>
            </div>
          )}
      </div>
    </div>
  );
};
