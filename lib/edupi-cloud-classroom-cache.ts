import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { EduPiCloudError, type CloudScope, type createEduPiCloudClient } from "./edupi-cloud-client";

type Row = Record<string, unknown>;
type Client = ReturnType<typeof createEduPiCloudClient>;
type Query = { action: "roster" } | { action: "read"; domain: string; id: string; revision: number | null };
const MAX_BYTES = 3 * 1024 * 1024;
const row = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (scope: CloudScope) => ({ issuer: scope.issuer, accountId: scope.accountId, workspaceId: scope.workspaceId });
const invalid = (): never => { throw new EduPiCloudError("invalid_classroom_read", "云端班级读取结果未通过核对。", 502); };

function query(body: Row): Query | null {
  if (!["grades", "seating", "duty"].includes(String(body.domain))) return null;
  // The authoritative roster is workspace-wide and identical for all domains.
  if (body.action === "roster") return { action: "roster" };
  if (body.action !== "read" || typeof body.id !== "string" || !body.id || body.id.length > 240
    || body.revision !== undefined && !integer(body.revision)) return null;
  return { action: "read", domain: String(body.domain), id: body.id, revision: body.revision === undefined ? null : Number(body.revision) };
}

function verified(response: Row, selected: Query, scope: CloudScope): boolean {
  if (response.ok !== true || response.operation !== "classroom" || response.action !== selected.action
    || response.workspace_id !== scope.workspaceId || response.external_send !== false
    || typeof response.request_id !== "string" || !response.request_id) return false;
  if (selected.action === "roster") {
    if (!Array.isArray(response.students) || response.students.length > 500) return false;
    const students = response.students.map(row);
    return students.every(student => student && typeof student.student_id === "string" && student.student_id
      && typeof student.name === "string" && student.name && typeof student.class_name === "string"
      && Array.isArray(student.traits) && student.traits.every(trait => typeof trait === "string")
      && integer(student.revision) && integer(student.profile_revision))
      && new Set(students.map(student => student!.student_id)).size === students.length;
  }
  const record = row(response.record), input = row(record?.input);
  if (!record || record.id !== selected.id || record.domain !== selected.domain || !integer(record.revision)
    || selected.revision !== null && record.revision !== selected.revision
    || !input || typeof input.title !== "string" || typeof input.class_name !== "string" || !row(record.result)
    || !Array.isArray(record.issues) || !record.issues.every(issue => {
      const value = row(issue);
      return value && typeof value.code === "string" && typeof value.message === "string" && ["error", "warning"].includes(String(value.severity));
    }) || !Array.isArray(record.versions) || record.versions.some(version => !integer(row(version)?.revision))
    || typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))
    || typeof record.updated_at !== "string" || !Number.isFinite(Date.parse(record.updated_at))) return false;
  return true;
}

function privatePath(client: Client, scope: CloudScope, selected: Query): string {
  const directory = client.runtimeDirectory();
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32"
    && ((stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("classroom_cache_permissions");
  }
  const key = createHash("sha256").update(JSON.stringify([identity(scope), selected])).digest("hex");
  return path.join(directory, `classroom-read-${key}.json`);
}

function privateFile(stat: fs.Stats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_BYTES
    && (process.platform === "win32" || (stat.mode & 0o077) === 0
      && (typeof process.getuid !== "function" || stat.uid === process.getuid()));
}

function load(client: Client, scope: CloudScope, selected: Query): Row | null {
  let descriptor: number | undefined;
  try {
    const filename = privatePath(client, scope, selected);
    if (!privateFile(fs.lstatSync(filename))) return null;
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    if (!privateFile(fs.fstatSync(descriptor))) return null;
    const saved = row(JSON.parse(fs.readFileSync(descriptor, "utf8")));
    const response = row(saved?.response);
    if (!saved || saved.version !== 1 || JSON.stringify(saved.scope) !== JSON.stringify(identity(scope))
      || JSON.stringify(saved.query) !== JSON.stringify(selected) || !response || !verified(response, selected, scope)) return null;
    return response;
  } catch { return null; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

async function assertScope(client: Client, scope: CloudScope) {
  if (typeof client.assertScope === "function") await client.assertScope(scope);
}

/** Cache only authenticated, identity-checked network reads; never receipts. */
export async function rememberCloudClassroomRead(client: Client, scope: CloudScope, body: Row, response: Row): Promise<void> {
  if (typeof client.runtimeDirectory !== "function") return;
  await assertScope(client, scope);
  const selected = query(body);
  if (!selected || !verified(response, selected, scope) || response.request_id !== body.request_id) return invalid();
  const queries: Query[] = [selected];
  if (selected.action === "read" && selected.revision === null) {
    queries.push({ ...selected, revision: Number(row(response.record)!.revision) });
  }
  // Persistence is advisory for a successful online read. Unsafe/missing cache
  // files simply remain unavailable for future offline preparation.
  for (const selected of queries) {
    try {
      const filename = privatePath(client, scope, selected);
      try { if (!privateFile(fs.lstatSync(filename))) continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue; }
      const existing = load(client, scope, selected);
      if (selected.action === "read" && selected.revision === null
        && Number(row(existing?.record)?.revision) > Number(row(response.record)?.revision)) continue;
      const bytes = JSON.stringify({ version: 1, scope: identity(scope), query: selected, response });
      if (Buffer.byteLength(bytes) > MAX_BYTES) continue;
      writePrivateFileAtomicSync(filename, bytes);
    } catch { /* A cache failure never changes the verified network response. */ }
  }
  await assertScope(client, scope);
}

export async function cachedCloudClassroomRead(client: Client, scope: CloudScope, body: Row): Promise<Row | null> {
  await assertScope(client, scope);
  const selected = query(body);
  const response = selected && typeof client.runtimeDirectory === "function" ? load(client, scope, selected) : null;
  await assertScope(client, scope);
  return response;
}

function unavailable(error: unknown): boolean {
  return error instanceof EduPiCloudError && error.status >= 500
    && !/^(invalid_|unsupported_|configuration_|readback_)/u.test(error.code);
}

/** Fallback is explicitly limited to input preparation. Write verifiers must
 * keep using client.operation directly and must never call this function. */
export async function readCloudClassroomForPreparation(
  client: Client, scope: CloudScope, body: Row, allowCached = true,
): Promise<Row> {
  await assertScope(client, scope);
  let response: Row;
  try { response = await client.operation("classroom", body, scope); }
  catch (error) {
    if (allowCached && unavailable(error)) {
      const saved = await cachedCloudClassroomRead(client, scope, body);
      if (saved) return saved;
    }
    throw error;
  }
  // Validate/cache outside the catch: malformed successful responses cannot
  // silently fall back to an older cache or poison the next offline write.
  await rememberCloudClassroomRead(client, scope, body, response);
  return response;
}
