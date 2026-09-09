import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";
import { normalizePreparationArtifact } from "./edupi-preparation-artifact-client";

export async function preparationArtifactRequest(action: "read" | "revise", input: Record<string, unknown>, signal?: AbortSignal) {
  const result = await runCoreProcess<{ ok: boolean; code?: string; artifact?: unknown; unchanged?: boolean }>({ ...resolveEduPiBridgeRoots(), timeoutMs: 15000, signal, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "preparation-artifacts", action, input } });
  if (!result.ok) throw Object.assign(new Error("产物读取或修订失败"), { code: result.code || "unavailable" });
  const artifact = normalizePreparationArtifact(result.artifact);
  if (artifact.artifact_id !== input.artifact_id) throw new Error("产物身份不匹配");
  return { artifact, unchanged: result.unchanged === true };
}
