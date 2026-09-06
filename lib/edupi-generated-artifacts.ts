import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";

export type GeneratedArtifact = { artifact_id: string; title: string; relative_path: string; session_id: string; task_id: string | null; updated_at: string; size_bytes: number };
const extensions = new Set([".md", ".txt", ".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".html"]);

export async function generatedArtifactsRequest(action: "list" | "register", fields: Record<string, unknown> = {}) {
  const roots = resolveEduPiBridgeRoots();
  const response = await runCoreProcess<{ ok: boolean; artifacts?: GeneratedArtifact[]; artifact?: GeneratedArtifact }>({
    ...roots, timeoutMs: 5000,
    request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "generated-artifacts", action, ...fields },
  });
  if (!response.ok) throw new Error("产物登记暂不可用");
  return response;
}

export function snapshotGeneratedFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (directory: string, depth: number) => {
    if (depth > 6 || files.size >= 2000) return;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { visit(file, depth + 1); continue; }
      if (!entry.isFile() || !extensions.has(extname(file).toLowerCase())) continue;
      try { const stat = statSync(file); files.set(file, `${stat.mtimeMs}:${stat.size}`); } catch { /* File can be moved by the active tool. */ }
    }
  };
  for (const directory of [".edupi/output", "教学产物", "deliverables", "output"]) visit(resolve(root, directory), 0);
  return files;
}
