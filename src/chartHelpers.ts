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
 * 将 FileNode 转换为 ECharts 需要的树形结构
 * @param node 当前节点
 * @param maxDepth 最大深度 (相对于当前根节点)
 * @param thresholdRatio 聚合阈值 (0-1), 小于该比例的子项会被合并为 "其他"
 * @param currentDepth 当前递归深度
 */
export const processForECharts = (
  node: FileNode, 
  maxDepth: number = 6, 
  thresholdRatio: number = 0.005,
  currentDepth: number = 0
): EChartsNode | null => {
  // 即使大小为0，如果是目录也应该显示（给予一个最小展示大小），以便用户可以下钻
  // Even if size is 0, if it's a directory, it should be displayed (give a minimal display size) so users can drill down
  const rawSize = node.size || 0;
  // 为空目录或未计算大小的目录提供一个视觉上的最小占位大小（例如 4KB），保证在图中可见
  // Provide a visual placeholder size (e.g., 4KB) for empty dirs or dirs with uncalculated size to ensure visibility
  const visualSize = (rawSize === 0 && node.is_dir) ? 4096 : rawSize;
  
  if (visualSize === 0) return null;

  // 防御性编程：检测并移除根节点下的冗余“自身包裹”层级
  // Defensive: Detect and remove redundant "self-wrapping" level under root
  if (currentDepth === 0 && node.children && node.children.length > 0) {
    // 查找是否有子节点看起来像是根节点的“分身”（名称相似且大小接近）
    // Find if any child looks like a "clone" of root (similar name and size)
    const cloneChildIndex = node.children.findIndex(child => {
       const isNameMatch = child.name === node.name || (node.path.endsWith(':\\') && child.name === node.path.replace(':\\', ''));
       // 大小非常接近（>99%），几乎可以确定是同一个目录的冗余层级
       const isSizeMatch = (child.size || 0) > (rawSize * 0.99); 
       return isNameMatch && isSizeMatch;
    });

    if (cloneChildIndex !== -1) {
       const cloneChild = node.children[cloneChildIndex];
       // 如果找到了这样的克隆子节点，我们直接处理这个克隆子节点，并将其视为根节点（currentDepth=0）
       // 但为了不丢失其他兄弟节点（虽然理论上如果是克隆不该有兄弟，但为了健壮性），我们只取克隆子节点
       // If found, process it as root. Ignore siblings as a true clone wrapper shouldn't have valid siblings.
       return processForECharts(cloneChild, maxDepth, thresholdRatio, 0);
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
    // 包含大小为0的子节点（只要是目录），这样用户可以看到结构
    // Include children with size 0 (as long as they are directories), so users can see the structure
    const validChildren = node.children.filter(c => (c.size || 0) > 0 || c.is_dir);
    
    if (validChildren.length === 0) return result;

    validChildren.sort((a, b) => (b.size || 0) - (a.size || 0));

    const processedChildren: EChartsNode[] = [];
    let otherSize = 0;
    let otherCount = 0;
    
    // 增加保留数量，确保每层显示更多细节
    // Increase retention count to ensure more details per layer
    const minItemsToShow = 20;

    validChildren.forEach((child, index) => {
      const childSize = child.size || 0;
      // 使用 visualSize 作为分母，避免除以 0
      const ratio = childSize / (visualSize || 1);
      
      const isTopItem = index < minItemsToShow;
      const isSignificant = ratio >= thresholdRatio;
      // 目录总是显示，除非它真的太小且不是 top item
      // Dirs are always shown unless really small and not top item
      const shouldShow = isTopItem || isSignificant || (child.is_dir && index < 30);

      if (shouldShow) {
        const childNode = processForECharts(child, maxDepth, thresholdRatio, currentDepth + 1);
        if (childNode) {
          processedChildren.push(childNode);
        }
      } else {
        otherSize += childSize;
        otherCount++;
      }
    });

    if (otherSize > 0) {
      processedChildren.push({
        name: `其他 (${otherCount}项)`,
        value: otherSize,
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
