type MappingKey = "name" | "traits" | "parentNotes" | "className";
const MAPPING_KEYS: readonly MappingKey[] = ["name", "traits", "parentNotes", "className"];

export class SuggestionError extends Error {
  constructor(public readonly code: "invalid_input" | "invalid_output" | "unavailable", message: string) {
    super(message);
  }
}

export function parseSuggestionHeaders(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "headers")) throw new SuggestionError("invalid_input", "请选择表头行。");
  const headers = (value as { headers?: unknown }).headers;
  if (!Array.isArray(headers) || headers.length < 1 || headers.length > 100 || headers.some((item) => typeof item !== "string" || item.length > 120 || /[\u0000-\u001f]/u.test(item))) throw new SuggestionError("invalid_input", "表头格式无效，最多 100 列，每列不超过 120 字。");
  if (!headers.some((item) => item.trim())) throw new SuggestionError("invalid_input", "表头不能为空。");
  return headers.map((item: string) => item.trim());
}

export function parseRosterMappingSuggestion(output: string, width: number): number[] {
  let value: unknown;
  try { value = JSON.parse(output.trim()); }
  catch { throw new SuggestionError("invalid_output", "AI 未能识别列名，请手动对应。"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !MAPPING_KEYS.includes(key as MappingKey))) throw new SuggestionError("invalid_output", "AI 列名建议无效，请手动对应。");
  const proposal = value as Record<string, unknown>;
  const columns = MAPPING_KEYS.map((key) => proposal[key]);
  if (columns.some((index, position) => !Number.isInteger(index) || (position === 0 ? (index as number) < 0 : (index as number) < -1) || (index as number) >= width)) throw new SuggestionError("invalid_output", "AI 列名建议无效，请手动对应。");
  const selected = columns.filter((index) => index !== -1);
  if (new Set(selected).size !== selected.length) throw new SuggestionError("invalid_output", "AI 建议重复使用同一列，请手动对应。");
  return columns as number[];
}

export async function suggestStudentRosterColumns(headers: string[], complete: (headers: string[]) => Promise<string>): Promise<number[]> {
  return parseRosterMappingSuggestion(await complete(headers), headers.length);
}
