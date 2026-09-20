/**
 * 扫描增量合并工具。
 *
 * 将「后台扫描暂停区」中的待处理更新（structure + size）抽取为独立纯函数，
 * 由 useAppLogic 传入其持有的两个 useRef，从而把树合并逻辑与 hook 状态解耦。
 *
 * 依据架构规则：文件树操作必须是纯函数（不直接触碰 React 状态）——
 * 本模块只读取并清空调用方传入的 Ref 队列，不引入任何 React hook。
 */

import type { FileNode, SizeUpdate, StructureUpdate } from "../types";
import {
  applyBatchUpdates,
  buildUpdatesByParent,
  getAffectedPaths,
} from "./treeUtils";

/** 待处理更新的队列容器（即 useAppLogic 中的两个 useRef） */
type QueueRef<T> = { current: T };

/**
 * 读取并清空待处理更新队列，返回两份拷贝。
 * @param structureRef 待处理结构更新队列（structure updates）
 * @param sizeRef      待处理大小更新队列（size updates）
 */
export function drainPendingUpdates(
  structureRef: QueueRef<Map<string, StructureUpdate>>,
  sizeRef: QueueRef<Map<string, SizeUpdate>>
) {
  const sUpdates = new Map(structureRef.current);
  const zUpdates = new Map(sizeRef.current);
  structureRef.current.clear();
  sizeRef.current.clear();
  return { sUpdates, zUpdates };
}

/**
 * 将待处理更新应用到整棵现有树。
 * @param root             现有的整棵树
 * @param structureRef     待处理结构更新队列
 * @param sizeRef          待处理大小更新队列
 */
export function applyPendingToFullTree(
  root: FileNode,
  structureRef: QueueRef<Map<string, StructureUpdate>>,
  sizeRef: QueueRef<Map<string, SizeUpdate>>
): FileNode {
  const { sUpdates, zUpdates } = drainPendingUpdates(structureRef, sizeRef);
  if (sUpdates.size === 0 && zUpdates.size === 0) return root;
  const appliedPaths = new Set<string>();
  const updatesByParent = buildUpdatesByParent(sUpdates);
  return applyBatchUpdates(
    root,
    sUpdates,
    zUpdates,
    getAffectedPaths([sUpdates, zUpdates]),
    true,
    appliedPaths,
    updatesByParent
  );
}