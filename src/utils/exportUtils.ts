import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

export type ExportFormat = 'csv' | 'json';

/**
 * 将二维行数据以 CSV 或 JSON 格式写盘。
 * CSV 遵循 RFC4180（内容含逗号/引号/换行时自动加引号转义）。
 * JSON 输出为 header → value 的对象数组（缩进 2 空格）。
 *
 * @param format  导出格式 csv|json
 * @param filename 默认文件名（不含扩展名）
 * @param headers  表头（CSV 首行 / JSON 字段名）
 * @param rows     数据行，长度须与 headers 一致
 * @returns 保存路径；用户取消返回 null
 */
export async function exportTabularData(
  format: ExportFormat,
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): Promise<string | null> {
  const filePath = await save({
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
    defaultPath: `${filename}.${format}`,
  });
  if (!filePath) return null;

  if (format === 'json') {
    const objects = rows.map((row) => {
      const obj: Record<string, string | number | null | undefined> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i];
      });
      return obj;
    });
    await writeTextFile(filePath, JSON.stringify(objects, null, 2));
    return filePath;
  }

  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  rows.forEach((row) => lines.push(row.map(esc).join(',')));
  await writeTextFile(filePath, lines.join('\n'));
  return filePath;
}