
interface DragOverlayProps {
  t: (key: string) => string;
}

export function DragOverlay({ t }: DragOverlayProps) {
  return (
    <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center">
      <div className="px-6 py-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-white/90 dark:bg-gray-900/90 shadow-lg text-center">
        <div className="text-base font-semibold">{t('dragHintTitle')}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('dragHintSubtitle')}</div>
      </div>
    </div>
  );
}
