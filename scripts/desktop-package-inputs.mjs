import path from "node:path";

export function isDesktopServerInput(root, file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return false;
  if (/^\.env(?:\.|$)/.test(relative)) return false;
  return ![".git", ".edupi", ".next", "src-tauri", ".next-desktop/standalone"].some(directory => relative === directory || relative.startsWith(`${directory}/`));
}
