export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}

/**
 * 判断当前是否运行在 Tauri 环境中。
 * Check if the app is running in a Tauri environment.
 */
export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/**
 * 判断当前是否为 macOS 系统。
 * Check if the current OS is macOS.
 */
export const isMacOS = () => {
  if (typeof window === 'undefined') return false;
  // 优先使用 userAgentData (如果支持)，否则回退到 userAgent
  // Prefer userAgentData if available, fallback to userAgent
  const platform = (window.navigator as any).userAgentData?.platform || window.navigator.platform;
  const userAgent = window.navigator.userAgent;
  
  return /Mac/i.test(platform) || /Mac/i.test(userAgent);
};

export const isWindows = () => {
  if (typeof window === 'undefined') return false;
  const platform = (window.navigator as any).userAgentData?.platform || window.navigator.platform;
  const userAgent = window.navigator.userAgent;
  return /Win/i.test(platform) || /Win/i.test(userAgent);
};
