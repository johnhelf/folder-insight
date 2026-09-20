/**
 * AI API Key 的本地混淆（非加密）工具。
 *
 * 目的：仅对抗"随眼可见 / 日志泄漏"，让 localStorage 中的 key 不以明文出现。
 * 说明：这是可逆混淆（XOR + 盐 + Base64），不提供密码学安全，避免用户误以为已加密。
 * 存储格式：`fk:` 前缀 + Base64(XOR(明文, 盐))；旧版遗留的明文 key 在读取时兼容并迁移。
 */

const SALT = 'FolderInsight::ai_key::v1';
const PREFIX = 'fk:';

/** 字节级 XOR（UTF-8 bytes 与盐逐字节异或）后 Base64。 */
export function obfuscate(plain: string): string {
  const bytes = new TextEncoder().encode(plain);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ SALT.charCodeAt(i % SALT.length);
  }
  let binary = '';
  out.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

/** 反向：Base64 解码 → 逐字节异或 → UTF-8 文本。 */
export function deobfuscate(encoded: string): string {
  const binary = atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length);
  }
  return new TextDecoder().decode(out);
}

/** 掩码回显：仅保留前 3 位与末 4 位，中间用 **** 代替。 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return key.slice(0, 2) + '****';
  return key.slice(0, 3) + '****' + key.slice(-4);
}

/** 从 localStorage 读取并解密；兼容旧版明文（自动迁移为混淆格式）。 */
export function loadApiKey(): string {
  const raw = localStorage.getItem('ai_api_key') || '';
  if (!raw) return '';
  if (raw.startsWith(PREFIX)) {
    try {
      return deobfuscate(raw.slice(PREFIX.length));
    } catch {
      return '';
    }
  }
  // 旧版明文遗留：返回明文，写入时由 saveApiKey 自动迁移为混淆格式。
  return raw;
}

/** 混淆后写入 localStorage。 */
export function saveApiKey(plain: string): void {
  if (!plain) {
    localStorage.removeItem('ai_api_key');
    return;
  }
  localStorage.setItem('ai_api_key', PREFIX + obfuscate(plain));
}