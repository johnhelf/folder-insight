import { FileNode, SizeUpdate, StructureUpdate } from "../types";

/**
 * 用于事件匹配的路径标准化：忽略大小写与分隔符差异，去除末尾斜杠。
 * Normalize path for event matching: ignore case and slash differences, remove trailing slash.
 */
export const normalizePathForMatch = (p: string) => {
  if (!p) return "";
  let normalized = p.replace(/\\/g, '/').toLowerCase();
  // 去除末尾斜杠（除非是根路径如 "c:/" 或 "/"）
  // Remove trailing slash (unless it is root "c:/" or "/")
  if (normalized.length > 1 && normalized.endsWith('/')) {
      // 特殊情况：windows 盘符 "c:/" -> "c:"，或者保留 "c:/"？
      // 如果 Rust 端的 normalize_path_string 对于 "C:\" 返回 "C:\"，那么这里变成 "c:/"
      // 如果 Rust 端对于 "C:" 返回 "C:"，那么这里变成 "c:"
      // 为了统一，我们去掉末尾斜杠。
      // For consistency, remove trailing slash.
      normalized = normalized.slice(0, -1);
  }
  return normalized;
};

/**
 * 排序子节点：目录优先，其次大小降序（null 视为 -1，排在最后），最后按名称。
 * Sort children: folders first, then size desc (null as -1, last), then by name.
 */
export const sortChildren = (children: FileNode[]) => {
  children.sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;

    const sizeA = a.size === null ? -1 : a.size;
    const sizeB = b.size === null ? -1 : b.size;
    if (sizeB !== sizeA) return sizeB - sizeA;

    return a.name.localeCompare(b.name);
  });
  return children;
};

/**
 * 递归排序整个树
 * Recursively sort the entire tree
 */
export const sortTreeRecursive = (node: FileNode): FileNode => {
  if (!node.children) return node;
  const newChildren = node.children.map(sortTreeRecursive);
  sortChildren(newChildren);
  return { ...node, children: newChildren };
};

/**
 * 在树中按路径查找节点。
 * Find a node in the tree by its path.
 */
export const findNodeByPath = (root: FileNode, path: string): FileNode | null => {
  if (normalizePathForMatch(root.path) === normalizePathForMatch(path)) return root;
  if (!root.children) return null;

  for (const child of root.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
};

/**
 * 替换指定路径节点的 children、size 和 file_count，并尽量避免无意义的全树拷贝。
 * Replace children, size, and file_count at the target path while avoiding unnecessary full-tree cloning.
 */
export const updateNodeAtPath = (
  root: FileNode, 
  path: string, 
  update: Partial<FileNode>
): FileNode => {
  if (normalizePathForMatch(root.path) === normalizePathForMatch(path)) {
    return { ...root, ...update };
  }
  if (!root.children) return root;

  let changed = false;
  const newChildren = root.children.map(child => {
    const next = updateNodeAtPath(child, path, update);
    if (next !== child) changed = true;
    return next;
  });

  if (!changed) return root;
  return { ...root, children: newChildren };
};

export const getNodeMetricSize = (node: FileNode, metric: 'logical' | 'allocated' = 'logical') => {
  return metric === 'allocated' ? node.allocated_size : node.size;
};

export const getRealtimeSummary = (node: FileNode, metric: 'logical' | 'allocated' = 'logical') => {
  const children = node.children ?? [];
  const partialSize = children.reduce((acc, child) => acc + (getNodeMetricSize(child, metric) ?? 0), 0);
  const partialFileCount = children.reduce((acc, child) => acc + (child.file_count ?? 0), 0);
  const hasPending = children.some(
    child => child.is_dir && getNodeMetricSize(child, metric) === null
  );

  return { partialSize, partialFileCount, hasPending };
};

/**
 * Helper to index updates by their parent path for O(1) lookup
 * Enhanced: Recursively builds parent-child mapping up to the root to ensure
 * deep paths can be auto-vivified even if intermediate parents are missing in the update batch.
 */
export const buildUpdatesByParent = (structureUpdates: Map<string, StructureUpdate>): Map<string, string[]> => {
  const map = new Map<string, Set<string>>();
  
  for (const path of structureUpdates.keys()) {
      let currentPath = path;
      
      // Walk up the path and register all parent->child relationships
      // This ensures that if we have an update for A/B/C, we also ensure A knows about B, 
      // even if there is no explicit update for B.
      while (true) {
          const lastSlash = currentPath.lastIndexOf('/');
          if (lastSlash === -1) break;
          
          const parentPath = currentPath.substring(0, lastSlash);
          if (!parentPath) break; // Stop at root if empty (or handle "C:" case)
          
          if (!map.has(parentPath)) {
              map.set(parentPath, new Set());
          }
          map.get(parentPath)!.add(currentPath);
          
          // Move up one level
          currentPath = parentPath;
      }
  }
  
  // Convert Sets to Arrays
  const result = new Map<string, string[]>();
  for (const [k, v] of map) {
      result.set(k, Array.from(v));
  }
  return result;
};

/**
 * 生成所有受影响路径及其祖先路径的集合
 * Generate set of all affected paths and their ancestors
 */
export const getAffectedPaths = (updatesList: Map<string, any>[]): Set<string> => {
  const affected = new Set<string>();
  updatesList.forEach(map => {
    for (const rawPath of map.keys()) {
      // rawPath is already normalized because keys are normalized
      let current = rawPath;
      affected.add(current);
      
      while (true) {
        const lastSlash = current.lastIndexOf('/');
        if (lastSlash === -1) break;
        
        current = current.substring(0, lastSlash);
        
        if (current.length > 0) {
          affected.add(current);
        } else {
          break; 
        }
      }
    }
  });
  return affected;
};

/**
 * 批量应用更新（结构和大小），通过单次遍历树实现 O(N) 复杂度。
 * Batch apply updates (structure and size) with single tree traversal O(N).
 * 优化：只遍历受影响的路径 / Optimization: Only traverse affected paths
 * 
 * NEW: Supports auto-vivification of missing child nodes based on structure updates.
 */
export const applyBatchUpdates = (
  node: FileNode,
  structureUpdates: Map<string, StructureUpdate>,
  sizeUpdates: Map<string, SizeUpdate>,
  affectedPaths: Set<string>,
  _isRoot: boolean = false,
  appliedPaths: Set<string>,
  // Optional index for faster lookups of children updates
  updatesByParent?: Map<string, string[]> 
): FileNode => {
  const normalizedPath = normalizePathForMatch(node.path);
  const isVirtualRoot = node.path === "ALL_DISKS" || node.path.startsWith("PHYSICAL_DISK:");
  
  // Debugging: Log path matching for root or first level children to verify normalization
  if (_isRoot && structureUpdates.size > 0) {
      // console.log(`[applyBatchUpdates] Root path: ${normalizedPath}. Pending structure updates: ${structureUpdates.size}`);
  }

  // Optimization: Skip if path is not affected (and we are not forcing full update with empty set)
  // BUT: If we have pending child updates for this node (even if node itself is not marked affected), we must process it!
  // The "affectedPaths" set might not contain the parent if only the child was updated.
  // So we need to check updatesByParent too.
  let hasPendingChildUpdates = false;
  if (updatesByParent && updatesByParent.has(normalizedPath)) {
      hasPendingChildUpdates = true;
  }

  if (affectedPaths.size > 0 && !affectedPaths.has(normalizedPath) && !hasPendingChildUpdates && !isVirtualRoot) {
      return node;
  }

  let newNode = node;
  
  // 1. 应用结构更新 / Apply structure update
  if (structureUpdates.has(normalizedPath)) {
    appliedPaths.add(normalizedPath); // Mark as applied
    const update = structureUpdates.get(normalizedPath)!;
    // Ensure children are not null if update provides empty array
    const newChildren = update.children || [];

    // We need to merge newChildren with existing children to preserve calculated sizes/counts of sub-directories
    // otherwise a structure update resets everything to 0/null until next size update arrives.
    const prevChildrenMap = new Map((newNode.children || []).map(c => [normalizePathForMatch(c.path), c]));

    const mergedChildren = newChildren.map(newChild => {
      const prevChild = prevChildrenMap.get(normalizePathForMatch(newChild.path));
      if (prevChild) {
        // 如果新节点有子节点（通常是浅层的），我们需要递归合并旧节点的子节点（深层的）
        // If newChild has children (usually shallow), we need to recursively merge old children (deep)
        let finalChildren = newChild.children;
        
        if (newChild.children && newChild.children.length > 0) {
           // 新节点有子节点列表，我们需要保留其中匹配到的旧子节点的深层结构
           // New node has children list, we must preserve deep structure of matched old children
           const oldGrandChildrenMap = new Map((prevChild.children || []).map(c => [normalizePathForMatch(c.path), c]));
           
           finalChildren = newChild.children.map(grandChild => {
               const oldGrandChild = oldGrandChildrenMap.get(normalizePathForMatch(grandChild.path));
               if (oldGrandChild) {
                   // 递归保留孙节点的子节点和统计数据
                   // Recursively preserve grandchildren's children and stats
                   return {
                       ...grandChild,
                       children: (grandChild.children && grandChild.children.length > 0) ? grandChild.children : oldGrandChild.children,
                       // Heuristic: if new size is 0 and old size > 0, keep old size
                       size: (grandChild.size === 0 && (oldGrandChild.size || 0) > 0) ? oldGrandChild.size : (grandChild.size ?? oldGrandChild.size),
                       allocated_size: grandChild.allocated_size ?? oldGrandChild.allocated_size,
                       file_count: (grandChild.is_dir && !grandChild.file_count) ? oldGrandChild.file_count : grandChild.file_count,
                       is_restricted: grandChild.is_restricted || oldGrandChild.is_restricted,
                       modified: grandChild.modified ?? oldGrandChild.modified,
                   };
               }
               return grandChild;
           });
        } else {
           // 新节点没有子节点（或为空），直接保留旧子节点
           // New node has no children, keep old children
           finalChildren = prevChild.children;
        }

        return {
          ...newChild,
          children: finalChildren,
          // Preserve calculated stats if newChild doesn't have them
          // Heuristic: if new size is 0 and old size > 0, keep old size
          size: (newChild.size === 0 && (prevChild.size || 0) > 0) ? prevChild.size : (newChild.size ?? prevChild.size),
          allocated_size: newChild.allocated_size ?? prevChild.allocated_size,
          file_count: (newChild.is_dir && !newChild.file_count) ? prevChild.file_count : newChild.file_count,
          is_restricted: prevChild.is_restricted || newChild.is_restricted,
          modified: newChild.modified ?? prevChild.modified,
        };
      }
      return newChild;
    });

    newNode = { ...newNode, children: mergedChildren };
  }

  // 1.5. Auto-vivify missing children based on updatesByParent
  // This handles the case where a child update arrives BEFORE the parent update, or parent update is missing.
  if (updatesByParent && updatesByParent.has(normalizedPath)) {
      const childPaths = updatesByParent.get(normalizedPath)!;
      const currentChildrenMap = new Map((newNode.children || []).map(c => [normalizePathForMatch(c.path), c]));
      let childrenModified = false;
      
      const newChildrenList = [...(newNode.children || [])];

      for (const childPath of childPaths) {
          if (!currentChildrenMap.has(childPath)) {
              // This child is missing! Create a placeholder.
              // We need the name. Extract from path.
              // normalizedPath uses '/'
              const lastSlash = childPath.lastIndexOf('/');
              const name = lastSlash !== -1 ? childPath.substring(lastSlash + 1) : childPath;
              
              // Try to find the original raw path from the update to be correct with separators if possible
              // But structureUpdates keys are normalized. We can check the update object itself if it exists.
              const update = structureUpdates.get(childPath);
              const rawPath = update ? update.path : childPath; // Fallback
              const rawName = update ? (update.path.split(/[/\\]/).pop() || name) : name;

              const placeholderChild: FileNode = {
                  name: rawName,
                  path: rawPath,
                  is_dir: true, // It has structure update, so it must be a dir
                  children: [],
                  size: 0,
                  file_count: 0,
                  is_restricted: false,
                  modified: null,
                  allocated_size: null
              };

              newChildrenList.push(placeholderChild);
              currentChildrenMap.set(childPath, placeholderChild); // Update map for subsequent checks
              childrenModified = true;
              
              // Mark the auto-vivified child as applied since we created it
              appliedPaths.add(childPath);

              // console.log(`[applyBatchUpdates] Auto-vivified missing child: ${rawPath} under ${newNode.path}`);
          }
      }

      if (childrenModified) {
          newNode = { ...newNode, children: newChildrenList };
      }
  }

  // 2. 应用大小更新 / Apply size update
  if (sizeUpdates.has(normalizedPath)) {
    appliedPaths.add(normalizedPath); // Mark as applied
    const update = sizeUpdates.get(normalizedPath)!;
    newNode = {
      ...newNode,
      // Heuristic: if new size is 0 and old size > 0, keep old size to prevent flashing
      size: (update.size === 0 && (newNode.size || 0) > 0) ? newNode.size : update.size,
      allocated_size: update.allocated_size,
      is_restricted: update.is_restricted,
      file_count: update.file_count,
    };
  }

  // 3. 递归处理子节点 / Recurse into children
  if (!newNode.children) return newNode;

  let childrenChanged = false;
  const newChildren = newNode.children.map(child => {
    // 移除剪枝优化，确保所有受影响的子节点都能更新
    // Remove pruning optimization to ensure all affected children are updated
    const newChild = applyBatchUpdates(child, structureUpdates, sizeUpdates, affectedPaths, false, appliedPaths, updatesByParent);
    if (newChild !== child) childrenChanged = true;
    return newChild;
  });

  if (childrenChanged || newNode !== node) {
    // Sort children inline to avoid full tree cloning later
    sortChildren(newChildren);
    
    // 如果是虚拟根节点，它不会收到 Rust 的大小更新，因此需要从子节点汇总
    // If it's a virtual root, it won't receive size updates from Rust, so we aggregate from children
    if (isVirtualRoot) {
      let totalSize = 0;
      let totalAllocated = 0;
      let totalFileCount = 0;
      
      for (const child of newChildren) {
        totalSize += child.size || 0;
        totalAllocated += child.allocated_size || 0;
        totalFileCount += child.file_count || 0;
      }
      
      return {
        ...newNode,
        children: newChildren,
        size: totalSize,
        allocated_size: totalAllocated,
        file_count: totalFileCount
      };
    }
    
    return { ...newNode, children: newChildren };
  }

  // 即使没有结构改变，如果是虚拟根节点，并且子节点的大小（虽然不是从这里改变的）可能需要汇总？
  // 但是如果子节点的大小改变了，applyBatchUpdates 会返回新的子节点，所以 childrenChanged 必然为 true。
  // 因此上面的 if 会捕获到。
  
  return node;
};
