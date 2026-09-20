import React from "react";
import { Inbox, AlertCircle, SearchX } from "lucide-react";

interface UnifiedStateProps {
  /** idle=待开始 / empty=无结果 / error=出错 */
  variant: "idle" | "empty" | "error";
  /** 主标题 */
  title: string;
  /** 次要说明文案（可选） */
  hint?: string;
  /** 可选动作按钮 */
  actionLabel?: string;
  onAction?: () => void;
  /** 自定义图标（可选，覆盖默认） */
  customIcon?: React.ReactNode;
}

/**
 * 统一状态面板：空闲 / 无结果 / 出错 三种空态，保证各视图状态一致。
 */
export const UnifiedState: React.FC<UnifiedStateProps> = ({
  variant,
  title,
  hint,
  actionLabel,
  onAction,
  customIcon,
}) => {
  const isError = variant === "error";
  const DefaultIcon =
    variant === "empty" ? SearchX : variant === "error" ? AlertCircle : Inbox;
  const icon = customIcon ?? <DefaultIcon size={64} className="opacity-20" />;

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
      <div className={isError
        ? "bg-red-50 dark:bg-red-900/20 p-8 rounded-full mb-4 text-red-400 dark:text-red-300"
        : "bg-gray-100 dark:bg-gray-800 p-8 rounded-full mb-4 text-gray-400 dark:text-gray-500"
      }>
        {icon}
      </div>
      <p className={isError ? "text-lg font-medium text-red-600 dark:text-red-400" : "text-lg font-medium text-gray-500 dark:text-gray-400"}>
        {title}
      </p>
      {hint && (
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-md">
          {hint}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};