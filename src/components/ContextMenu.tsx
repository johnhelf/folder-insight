import { FolderOpen } from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  handleOpenInExplorer: () => void;
  t: (key: string) => string;
}

export function ContextMenu({ x, y, handleOpenInExplorer, t }: ContextMenuProps) {
  return (
    <div 
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={handleOpenInExplorer}
        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
      >
        <FolderOpen size={14} />
        {t('openInExplorer')}
      </button>
    </div>
  );
}
