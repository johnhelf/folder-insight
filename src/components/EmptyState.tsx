import { HardDrive } from "lucide-react";

interface EmptyStateProps {
  t: (key: string) => string;
}

export function EmptyState({ t }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
      <div className="bg-gray-100 dark:bg-gray-800 p-8 rounded-full mb-4">
        <HardDrive size={64} className="opacity-20" />
      </div>
      <p className="text-lg">{t('emptyHint')}</p>
    </div>
  );
}
