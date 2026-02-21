import React, { useRef, useEffect, useState, useMemo } from 'react';
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
      tooltip.style.top = isTop ? 'auto' : '1rem';
      tooltip.style.bottom = isTop ? '1rem' : 'auto';
      tooltip.style.left = isLeft ? 'auto' : '1rem';
      tooltip.style.right = isLeft ? '1rem' : 'auto';
    }
  };

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  // Aggregate data using d3.hierarchy directly
  const processedHierarchy = useMemo(() => {
    if (!data) return null;
    
    // 1. Create hierarchy and sum values
    // NOTE: We do NOT prune small nodes here anymore because processForECharts already handles aggregation.
    // If we prune here, we might remove the "Others" node if it is small, which is not desired.
    const root = d3.hierarchy(data)
        .sum(d => (d.children && d.children.length > 0) ? 0 : d.value)
        .sort((a, b) => (b.value || 0) - (a.value || 0));
    
    return root;
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

  useEffect(() => {
    if (!processedHierarchy || !svgRef.current || !containerRef.current) return;

    const width = dimensions.width || containerRef.current.clientWidth;
    const height = dimensions.height || containerRef.current.clientHeight;
    
    if (width === 0 || height === 0) return;

    // Radius: 30% of min dimension (reduced from 35% to ensure labels fit)
    const radius = Math.min(width, height) * 0.30;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg
      .attr("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`)
      .style("font", "12px 'SimHei', 'Microsoft YaHei', sans-serif")
      .append("g");

    const partition = d3.partition<EChartsNode>()
      .size([2 * Math.PI, radius]);

    const root = partition(processedHierarchy);

    // Color scale
    const topLevelCategories = (root.children || []).map(d => d.data.name);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(topLevelCategories);

    const getNodeColor = (d: d3.HierarchyRectangularNode<EChartsNode>) => {
        if (d.depth === 0) return "transparent";
        if (d.data.name.startsWith("其他") || d.data.name.startsWith("Other")) return "#e0e0e0";
        const ancestor = d.ancestors().find(n => n.depth === 1);
        const key = ancestor ? ancestor.data.name : d.data.name;
        return colorScale(key);
    };

    // Fixed layer width
    const effectiveLayers = 7;
    const layerWidth = 0.9 / effectiveLayers; 

    const arc = d3.arc<d3.HierarchyRectangularNode<EChartsNode>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius(d => {
        if (d.depth === 0) return 0;
        if (d.depth === 1) return radius * 0.10;
        return radius * (0.10 + (d.depth - 1) * layerWidth);
      })
      .outerRadius(d => {
        if (d.depth === 0) return radius * 0.05;
        return radius * (0.10 + (d.depth) * layerWidth) - 1;
      });

    // Draw Arcs
    // Filter extremely small arcs only for display performance, but keep "Others" which might be small but aggregated
    // 0.02 rad is approx 1 degree. We can filter truly invisible things.
    const displayThreshold = 0.005; 
    
    g.append("g")
      .selectAll("path")
      .data(root.descendants().filter(d => d.depth <= 7 && (d.x1 - d.x0) > displayThreshold))
      .join("path")
      .attr("fill", d => getNodeColor(d))
      .attr("fill-opacity", d => d.depth === 0 ? 1 : 1 - (d.depth * 0.08))
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
      })
      .on("contextmenu", (event, d) => {
        event.stopPropagation();
        if (onContextMenu) {
          let path = d.data.path;
          // If aggregated node (path is empty or specific name), use parent path
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

    // --- Enhanced Label Layout (Spider/Folded Line) ---
    const labelGroup = g.append("g")
        .attr("class", "label-container")
        .attr("pointer-events", "none")
        .style("font-size", "12px")
        .style("font-family", "sans-serif");

    // 1. Identify candidates (> 1 degree to be worth labeling)
    const labelThreshold = 0.02; // ~1.1 degrees
    const candidates = root.descendants().filter(d => 
        d.depth > 0 && 
        d.depth <= 7 && 
        (d.x1 - d.x0) > labelThreshold &&
        !d.data.name.startsWith("其他") && 
        !d.data.name.startsWith("Others")
    );

    // 2. Prepare label data
    const outerArcRadius = radius * 1.05;
    const labelArc = d3.arc<d3.HierarchyRectangularNode<EChartsNode>>()
        .innerRadius(outerArcRadius)
        .outerRadius(outerArcRadius + 10) // Give it some thickness for stable centroid
        .startAngle(d => d.x0)
        .endAngle(d => d.x1);

    interface LabelItem {
        node: d3.HierarchyRectangularNode<EChartsNode>;
        p0: [number, number]; // Arc centroid
        p1: [number, number]; // Elbow start (near outer ring)
        isRight: boolean;
        targetY: number;      // Ideal Y
        x: number;            // Final X
        y: number;            // Final Y
        color: string;        // Node color
    }

    const labels: LabelItem[] = candidates.map(d => {
        const p0 = arc.centroid(d);
        const p1 = labelArc.centroid(d);
        
        // Use x coordinate to determine side
        const isRight = p0[0] >= 0;

        return {
            node: d,
            p0,
            p1,
            isRight,
            targetY: p1[1],
            x: isRight ? radius * 1.45 : -radius * 1.45,
            y: p1[1],
            color: getNodeColor(d)
        };
    });

    // 3. Vertical Collision Resolution
    const spacing = 14; // Slightly tighter spacing
    
    const resolveCollisions = (items: LabelItem[]) => {
        if (items.length === 0) return;

        // Sort by Y from top to bottom
        items.sort((a, b) => a.targetY - b.targetY);
        
        // simple sweep to push down
        for (let i = 0; i < items.length; i++) {
            if (i === 0) continue;
            const prev = items[i-1];
            const curr = items[i];
            
            if (curr.y < prev.y + spacing) {
                curr.y = prev.y + spacing;
            }
        }

        // Check if we pushed too far down (centering logic)
        
        // Let's try to center the group of labels vertically if they are skewed
        const maxY = items[items.length - 1].y;
        
        // We want 'center' to be close to 0 (chart vertical center)
        // Shift all items by -center
        // But we must respect the original targetY order roughly.
        // This simple shift helps if the collision resolution pushed everything down.
        
        // However, we only pushed DOWN. So items tend to be lower than their targets.
        // We can shift them UP if they are too low.
        
        // Let's compute the shift needed to center the group around 0
        // BUT we should only shift if it doesn't move items too far from their targetY?
        // Actually, collision resolution is dominant.
        
        // Only shift if maxY > height/2 (bottom edge)
        const bottomLimit = height / 2 - 20;
        const topLimit = -height / 2 + 20;
        
        if (maxY > bottomLimit) {
            const shift = maxY - bottomLimit;
            items.forEach(item => item.y -= shift);
        }
        
        // Re-check top
        if (items[0].y < topLimit) {
            // If we shifted up and hit top, we are squeezed.
            // Just clamp top?
             const shiftDown = topLimit - items[0].y;
             items.forEach(item => item.y += shiftDown);
        }
    };

    const leftLabels = labels.filter(d => !d.isRight);
    const rightLabels = labels.filter(d => d.isRight);
    
    resolveCollisions(leftLabels);
    resolveCollisions(rightLabels);

    // 4. Draw Labels & Polylines using data join for interactivity
    const labelSelection = labelGroup.selectAll<SVGGElement, LabelItem>(".label-group")
        .data([...leftLabels, ...rightLabels])
        .join("g")
        .attr("class", "label-group")
        .style("opacity", 0.8);

    labelSelection.append("polyline")
        .attr("points", l => `${l.p0[0]},${l.p0[1]} ${l.p1[0]},${l.p1[1]} ${l.x},${l.y}`)
        .style("fill", "none")
        .style("stroke", "#64748b") // Default slate-500
        .style("stroke-width", "1.5px")
        .style("transition", "stroke 0.2s, stroke-width 0.2s");

    labelSelection.append("text")
        .attr("x", l => l.isRight ? l.x + 8 : l.x - 8)
        .attr("y", l => l.y)
        .attr("dy", "0.35em")
        .attr("text-anchor", l => l.isRight ? "start" : "end")
        // Truncate at 40 chars instead of 15
        .text(l => l.node.data.name.length > 40 ? l.node.data.name.slice(0, 37) + "..." : l.node.data.name)
        .style("fill", "currentColor")
        .style("font-weight", "600")
        .style("transition", "fill 0.2s");

  }, [processedHierarchy, canGoUp, dimensions]);

  // Effect to handle hover state for labels
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    const labelGroups = svg.selectAll<SVGGElement, any>(".label-group");
    
    if (!hoverNode) {
        // Reset to default
        labelGroups.style("opacity", 0.8);
        labelGroups.select("polyline")
            .style("stroke", "#64748b")
            .style("stroke-width", "1.5px");
        labelGroups.select("text")
            .style("fill", "currentColor");
    } else {
        // Highlight matching label, but do NOT dim others to avoid flickering
        labelGroups.each(function(d) {
            const isMatch = d.node === hoverNode || d.node.data.path === hoverNode.data.path;
            const el = d3.select(this);
            
            if (isMatch) {
                el.style("opacity", 1);
                el.select("polyline")
                    .style("stroke", d.color)
                    .style("stroke-width", "2.5px");
                el.select("text")
                    .style("fill", d.color);
            } else {
                // Keep default style for others
                el.style("opacity", 0.8);
                el.select("polyline")
                    .style("stroke", "#64748b")
                    .style("stroke-width", "1.5px");
                el.select("text")
                    .style("fill", "currentColor");
            }
        });
    }
  }, [hoverNode]);

  return (
    <div 
      className="flex-1 min-h-0 relative w-full h-full text-slate-600 dark:text-slate-300" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
    >
      <svg ref={svgRef} width="100%" height="100%"></svg>
      
      {/* Tooltip */}
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
