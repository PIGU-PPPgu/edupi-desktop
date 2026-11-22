import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CloudScope, createEduPiCloudClient } from "./edupi-cloud-client";
import { writePrivateFileAtomicSync } from "./atomic-file";
type Client = ReturnType<typeof createEduPiCloudClient>;
function file(client: Client, scope: CloudScope) {
  const id = createHash("sha256").update(JSON.stringify([scope.issuer, scope.accountId, scope.workspaceId])).digest("hex");
  return path.join(client.runtimeDirectory(), `entities-${id}.json`);
}
export function cacheCloudEntities(client: Client, scope: CloudScope, response: Record<string, unknown>) {
  if (response.workspace_id !== scope.workspaceId || !Array.isArray(response.states)
    || !Array.isArray(response.deletions) || !Array.isArray(response.history)) throw new Error("invalid_entity_index");
  if (typeof client.runtimeDirectory !== "function") return;
  writePrivateFileAtomicSync(file(client, scope), JSON.stringify(response));
}
export function cachedCloudEntities(client: Client, scope: CloudScope): Record<string, unknown> | null {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(file(client, scope), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (fs.fstatSync(descriptor).size > 2 * 1024 * 1024) return null;
    const value = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    return value.workspace_id === scope.workspaceId ? value : null;
  } catch { return null; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
