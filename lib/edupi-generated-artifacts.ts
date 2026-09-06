import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";
import type { EducationContract } from "./edupi-education-contract";

export type GeneratedArtifact = { artifact_id: string; title: string; relative_path: string; available?: boolean; session_id: string; task_id: string | null; updated_at: string; size_bytes: number };

export async function workspaceResourcesRequest() {
  const roots = resolveEduPiBridgeRoots();
  const result = await runCoreProcess<{ ok: boolean; artifacts: GeneratedArtifact[] | null; teacherMaterials: EducationContract["teacherMaterials"]; studentMetadata: Array<{ student_id: string; name: string; class_name: string | null }> }>({ ...roots, timeoutMs: 5000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "workspace-resources" } });
  if (!result.ok) throw new Error("工作区资源暂不可用");
  return result;
}
const extensions = new Set([".md", ".txt", ".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".html"]);

export function completedSessionFiles(entries: Array<Record<string, unknown>>, root: string): string[] {
  const writes = new Map<string, string>();
  const completed = new Set<string>();
  for (const entry of entries) {
    const message = entry.message as { role?: string; content?: Array<{ type?: string; name?: string; id?: string; arguments?: { path?: string } }>; toolCallId?: string; isError?: boolean } | undefined;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "toolCall" && (block.name === "write" || block.name === "edit") && block.id && typeof block.arguments?.path === "string") {
          const file = resolve(root, block.arguments.path);
          if (extensions.has(extname(file).toLowerCase())) writes.set(block.id, file);
        }
      }
    }
    if (message?.role === "toolResult" && !message.isError && message.toolCallId && writes.has(message.toolCallId)) completed.add(writes.get(message.toolCallId)!);
  }
  return [...completed];
}

export async function recoverSessionArtifacts(sessionFile: string, root: string, sessionId: string) {
  const entries = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const paths = completedSessionFiles(entries, root);
  const failed: string[] = [];
  let registered = 0;
  for (const file of paths) {
    try { await generatedArtifactsRequest("register", { file_path: file, session_id: sessionId }); registered++; }
    catch { failed.push(file); }
  }
  return { registered, failedCount: failed.length };
}

export async function generatedArtifactsRequest(action: "list" | "register" | "archive" | "restore", fields: Record<string, unknown> = {}) {
  const roots = resolveEduPiBridgeRoots();
  const response = await runCoreProcess<{ ok: boolean; artifacts?: GeneratedArtifact[]; artifact?: GeneratedArtifact; teacherMaterials?: EducationContract["teacherMaterials"] }>({
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
