import { FileNode } from './types';

export interface EChartsNode {
  name: string;
  value: number;
  path: string;
  isDir: boolean;
  children?: EChartsNode[];
  itemStyle?: {
    color?: string;
  };
}

/**
 * Process data specifically for Sunburst chart (Ring chart)
 * Includes angle-based aggregation to avoid clutter
 */
export const processForSunburst = (
  node: FileNode, 
  maxDepth: number = 6, 
  currentDepth: number = 0,
  rootSize: number = 0,
  t?: (key: string, params?: Record<string, any>) => string
): EChartsNode | null => {
  // Even if size is 0, if it's a directory, it should be displayed
  const rawSize = node.size || 0;
  const visualSize = (rawSize === 0 && node.is_dir) ? 4096 : rawSize;
  
  if (visualSize === 0) return null;

  // Initialize rootSize at the top level
  if (currentDepth === 0) {
      rootSize = visualSize;
  }

  // Defensive: Detect and remove redundant "self-wrapping" level under root
  if (currentDepth === 0 && node.children && node.children.length > 0) {
    const cloneChildIndex = node.children.findIndex(child => {
       const isNameMatch = child.name === node.name || (node.path.endsWith(':\\') && child.name === node.path.replace(':\\', ''));
       const isSizeMatch = (child.size || 0) > (rawSize * 0.99); 
       return isNameMatch && isSizeMatch;
    });

    if (cloneChildIndex !== -1) {
       const cloneChild = node.children[cloneChildIndex];
       return processForSunburst(cloneChild, maxDepth, 0, 0); 
    }
  }

  const result: EChartsNode = {
    name: node.name,
    value: visualSize,
    path: node.path,
    isDir: node.is_dir,
  };

  if (currentDepth >= maxDepth) {
    return result;
  }

  if (node.children && node.children.length > 0) {
    const validChildren = node.children.filter(c => (c.size || 0) > 0 || c.is_dir);
    
    if (validChildren.length === 0) return result;

    validChildren.sort((a, b) => (b.size || 0) - (a.size || 0));

    const processedChildren: EChartsNode[] = [];
    let otherSize = 0;
    let otherCount = 0;
    
    // 5 degrees = 5/360 approx 0.0139 (1.39%)
    const angleThresholdRatio = 5 / 360; 
    
    // Safety limit for sunburst to prevent UI lag
    const MAX_CHILDREN_TO_SHOW = 100;

    validChildren.forEach((child, index) => {
      const childSize = child.size || 0;
      const childVisualSize = (childSize === 0 && child.is_dir) ? 4096 : childSize;
      
      const absoluteRatio = childVisualSize / (rootSize || 1);
      
      let shouldShow = absoluteRatio >= angleThresholdRatio;

      // Always show at least one child if available
      if (index === 0 && validChildren.length > 0) shouldShow = true;

      if (processedChildren.length >= MAX_CHILDREN_TO_SHOW) {
          shouldShow = false;
      }

      if (shouldShow) {
        const childNode = processForSunburst(child, maxDepth, currentDepth + 1, rootSize, t);
        if (childNode) {
          processedChildren.push(childNode);
        }
      } else {
        otherSize += childSize;
        otherCount++;
      }
    });

    if (otherCount > 0) {
      const otherVisualSize = otherSize === 0 ? 4096 : otherSize;
      
      const otherLabel = t ? t('otherItems', { count: otherCount }) : `其他 (${otherCount}项)`;
      
      processedChildren.push({
        name: otherLabel, // This name will be used to filter labels in view
        value: otherVisualSize,
        path: '',
        isDir: true,
        itemStyle: {
          color: '#e0e0e0'
        },
        children: []
      });
    }

    if (processedChildren.length > 0) {
      result.children = processedChildren;
    }
  }

  return result;
};

/**
 * Process data specifically for Treemap
 * Shows more details, less aggregation
 */
export const processForTreemap = (
  node: FileNode, 
  maxDepth: number = 6, 
  currentDepth: number = 0
): EChartsNode | null => {
  const rawSize = node.size || 0;
  // Treemap can handle 0 size better if we want, but D3 treemap needs values.
  // We use same visual size logic for consistency
  const visualSize = (rawSize === 0 && node.is_dir) ? 4096 : rawSize;
  
  if (visualSize === 0) return null;

  // Defensive: Detect and remove redundant "self-wrapping" level under root
  if (currentDepth === 0 && node.children && node.children.length > 0) {
    const cloneChildIndex = node.children.findIndex(child => {
       const isNameMatch = child.name === node.name || (node.path.endsWith(':\\') && child.name === node.path.replace(':\\', ''));
       const isSizeMatch = (child.size || 0) > (rawSize * 0.99); 
       return isNameMatch && isSizeMatch;
    });

    if (cloneChildIndex !== -1) {
       const cloneChild = node.children[cloneChildIndex];
       return processForTreemap(cloneChild, maxDepth, 0); 
    }
  }

  const result: EChartsNode = {
    name: node.name,
    value: visualSize,
    path: node.path,
    isDir: node.is_dir,
  };

  if (currentDepth >= maxDepth) {
    return result;
  }

  if (node.children && node.children.length > 0) {
    const validChildren = node.children.filter(c => (c.size || 0) > 0 || c.is_dir);
    
    if (validChildren.length === 0) return result;

    validChildren.sort((a, b) => (b.size || 0) - (a.size || 0));

    const processedChildren: EChartsNode[] = [];
    
    // For Treemap, we want to show as much as possible, similar to original "small blocks"
    // No angle threshold. No strict max children limit (or very high).
    const MAX_CHILDREN_TO_SHOW = 1000; // Much higher limit for treemap

    validChildren.forEach((child) => {
      if (processedChildren.length >= MAX_CHILDREN_TO_SHOW) return;

      const childNode = processForTreemap(child, maxDepth, currentDepth + 1);
      if (childNode) {
        processedChildren.push(childNode);
      }
    });

    // No "Others" aggregation for Treemap - just cut off if too many
    // This gives the "dense" look user wants

    if (processedChildren.length > 0) {
      result.children = processedChildren;
    }
  }

  return result;
};

// Keep for backward compatibility if needed, or redirect to sunburst as default
export const processForECharts = (
  node: FileNode, 
  maxDepth: number = 6, 
  _thresholdRatio: number = 0.005,
  currentDepth: number = 0,
  rootSize: number = 0,
  t?: (key: string, params?: Record<string, any>) => string
): EChartsNode | null => {
    return processForSunburst(node, maxDepth, currentDepth, rootSize, t);
};
