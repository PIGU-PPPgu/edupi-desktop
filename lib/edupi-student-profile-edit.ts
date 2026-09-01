export function parseStudentProfileList(value: string): string[] {
  return Array.from(new Set(value.split(/[\n、;；|]/u).map((item) => item.trim()).filter(Boolean))).slice(0, 50);
}
