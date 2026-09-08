export function briefPreview(excerpt: string): string {
  return excerpt
    .replace(/^#\s*早安简报[^#\n]*/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*$/g, "$1")
    .replace(/(?:^|\s)#{1,6}\s+/g, " · ")
    .replace(/(?:^|\s)-\s+/g, " · ")
    .replace(/[\r\n]+/g, " · ")
    .replace(/(?:\s*·\s*)+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}
