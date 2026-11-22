import { createHash, randomUUID } from "node:crypto";
import { assertMobileDashboardContract, EduPiCloudContractError, type EduPiMobileDashboardResponse } from "./edupi-cloud-contract.ts";
import { cloudStateTransaction, readCloudState, cloudRuntimeDirectory, type EduPiCloudMode, type EduPiCloudOutboxEntry,
  type EduPiCloudSession, type EduPiCloudState } from "./edupi-cloud-store.ts";
import { cloudRecord as record, verifyCloudWrite, CloudReadbackError, CloudReadbackConflictError } from "./edupi-cloud-verification.ts";
import { buildCloudTaskEnvelope } from "./edupi-cloud-writer-contract.ts";
import { buildCloudIntakeEnvelope } from "./edupi-cloud-intake.ts";
import { assertCloudSyncContract } from "./edupi-cloud-sync-contract.ts";
import type { MaterialStagingDescriptor } from "./edupi-material-staging.ts";
import type { EducationIntakeCommand } from "./edupi-education-intake.ts";

const DEFAULT_URL = "https://edupi.intelliclass.online";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const refreshes = new Map<string, Promise<EduPiCloudState>>();
const deliveries = new Map<string, Promise<Record<string, unknown>>>();
const EDGE_OPERATIONS: Record<string, string> = {
  students: "edupi-students",
  entities: "edupi-entities",
  sessions: "edupi-sessions",
  runtime: "edupi-core-runtime",
  classroom: "edupi-classroom",
  "student-events": "edupi-student-events",
};
export type CloudScope = { issuer: string; accountId: string; workspaceId: string; generation: number };
type Workspace = { id: string; mode: string };
export type EduPiCloudClientOptions = {
  env?: NodeJS.ProcessEnv; stateDir?: string; fetchImpl?: typeof fetch; now?: () => number;
};
export class EduPiCloudError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 503) {
    super(message); this.name = "EduPiCloudError"; this.code = code; this.status = status;
  }
}
const fail = (code: string, message: string, status = 503): never => { throw new EduPiCloudError(code, message, status); };
const text = (value: unknown, max = 240): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  return object ? Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])])) : value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export function createEduPiCloudClient(options: EduPiCloudClientOptions = {}) {
  const env = options.env || process.env;
  const stateDir = options.stateDir || env.PI_DESKTOP_STATE_DIR;
  const transport = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const config = () => {
    let url: URL;
    try { url = new URL(env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim() || DEFAULT_URL); }
    catch { return fail("configuration_invalid", "Supabase 地址无效。"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      fail("configuration_invalid", "Supabase 必须使用 HTTPS 地址。");
    const anonKey = env.SUPABASE_ANON_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
    let role: unknown;
    try { role = anonKey && JSON.parse(Buffer.from(anonKey.split(".")[1], "base64url").toString("utf8")).role; }
    catch { /* New publishable keys are not JWTs. */ }
    if (role === "service_role" || anonKey?.startsWith("sb_secret_"))
      fail("configuration_invalid", "Desktop 只能配置 Supabase public key。");
    return { url: url.href.replace(/\/+$/u, ""), anonKey };
  };
  const tx = <T>(change: (state: EduPiCloudState) => { result: T; write?: boolean }) =>
    cloudStateTransaction(stateDir, change);
  async function state() {
    const current = await readCloudState(stateDir);
    const mode = env.EDUPI_DATA_MODE;
    if (mode && mode !== "local" && mode !== "cloud") fail("invalid_mode", "数据模式配置无效。");
    if (current.generation === 0 && (mode === "local" || mode === "cloud")) current.mode = mode;
    return current;
  }
  const assertIssuer = (current: EduPiCloudState) => {
    if (current.issuer && current.issuer !== config().url)
      fail("issuer_changed", "Supabase 地址已改变，请先退出原云端账号。", 409);
  };
  async function assertScope(scope: CloudScope) {
    const current = await state();
    assertIssuer(current);
    if (current.mode !== "cloud" || current.generation !== scope.generation || current.issuer !== scope.issuer
      || current.session?.user.id !== scope.accountId || current.workspaceId !== scope.workspaceId)
      fail("scope_changed", "账号、模式或工作区已改变，操作已停止。", 409);
    return current;
  }
  async function captureScope(): Promise<CloudScope> {
    const current = await state();
    assertIssuer(current);
    if (!current.session) return fail("login_required", "请先登录 Supabase。", 401);
    if (!current.workspaceId) return fail("workspace_required", "请选择工作区。", 409);
    const scope = { issuer: current.issuer!, accountId: current.session.user.id,
      workspaceId: current.workspaceId, generation: current.generation };
    await assertScope(scope);
    return scope;
  }
  async function request(path: string, init: { body?: unknown; token?: string; workspaceId?: string } = {}) {
    const current = config();
    if (!current.anonKey) return fail("configuration_missing", "尚未配置 Supabase public key。");
    try {
      const response = await transport(`${current.url}${path}`, {
        method: init.body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json", apikey: current.anonKey,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          ...(init.workspaceId ? { "x-edupi-workspace-id": init.workspaceId } : {}) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      if (response.status === 204) return {};
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); fail("invalid_response", "云端响应超过上限。", 502); }
          chunks.push(next.value);
        }
      }
      let body: Record<string, unknown> | null = null;
      try { body = record(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { /* Checked below. */ }
      if (!response.ok) {
        const code = text(body?.code, 80) && /^[a-z0-9_]+$/u.test(body!.code as string)
          ? body!.code as string : response.status === 401 ? "unauthorized" : "cloud_request_failed";
        fail(code, response.status === 401 ? "云端登录已过期，请重新登录。"
          : response.status === 409 ? "云端记录已改变，请处理同步冲突。"
          : response.status === 403 ? "当前账号没有此工作区的权限。" : "云端请求未成功。", response.status);
      }
      if (!body) fail("invalid_response", "云端响应格式无效。", 502);
      return body!;
    } catch (error) {
      if (error instanceof EduPiCloudError) throw error;
      return fail("network_unavailable", "无法连接云端，待同步记录已保留。");
    }
  }
  function session(value: Record<string, unknown>, id: string = randomUUID()): EduPiCloudSession {
    const user = record(value.user);
    const userId = user?.id;
    if (!text(value.access_token, 16384) || !text(value.refresh_token, 16384)
      || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 1
      || !text(userId) || !UUID.test(userId)) return fail("invalid_response", "云端登录响应无效。", 502);
    return { id, accessToken: value.access_token, refreshToken: value.refresh_token,
      expiresAt: new Date(now() + Number(value.expires_in) * 1000).toISOString(),
      user: { id: userId, email: text(user?.email, 320) ? user!.email as string : null } };
  }
  async function refresh(current?: EduPiCloudState): Promise<EduPiCloudState> {
    current ||= await state();
    assertIssuer(current);
    if (!current.session?.refreshToken) return fail("login_required", "请重新登录 Supabase。", 401);
    const captured = current, previous = current.session;
    const key = `${stateDir || "default"}:${current.issuer}:${previous.id}`;
    const running = refreshes.get(key);
    if (running) return running;
    const pending = (async () => {
      try {
        const updated = session(await request("/auth/v1/token?grant_type=refresh_token",
          { body: { refresh_token: previous.refreshToken } }), previous.id);
        if (updated.user.id !== previous.user.id) fail("account_mismatch", "云端返回的账号不一致。", 409);
        return await tx(latest => {
          if (latest.generation !== captured.generation || latest.session?.id !== previous.id)
            return { result: structuredClone(latest) };
          latest.session = updated;
          return { result: structuredClone(latest), write: true };
        });
      } catch (error) {
        if (error instanceof EduPiCloudError && [400, 401].includes(error.status)) {
          await tx(latest => {
            if (latest.session?.id !== previous.id) return { result: null };
            latest.session.accessToken = ""; latest.session.refreshToken = null;
            latest.session.expiresAt = new Date(0).toISOString();
            latest.generation++;
            return { result: null, write: true };
          });
        }
        throw error;
      }
    })();
    refreshes.set(key, pending);
    try { return await pending; } finally { if (refreshes.get(key) === pending) refreshes.delete(key); }
  }
  async function ensureSession() {
    let current = await state();
    assertIssuer(current);
    if (!current.session?.accessToken) return fail("login_required", "请登录 Supabase。", 401);
    if (Date.parse(current.session.expiresAt) - now() <= 30_000) current = await refresh(current);
    if (!current.session?.accessToken) return fail("login_required", "请重新登录 Supabase。", 401);
    return current;
  }
  async function listWorkspaces(): Promise<Workspace[]> {
    const current = await ensureSession();
    const response = await request("/functions/v1/edupi-account", { token: current.session!.accessToken });
    if (!Array.isArray(response.workspaces) || response.workspaces.some(item => {
      const row = record(item);
      return !text(row?.id) || !UUID.test(row!.id as string) || !["local", "cloud"].includes(String(row?.mode));
    })) return fail("invalid_response", "工作区列表无效。", 502);
    const latest = await state();
    if (latest.generation !== current.generation || latest.session?.id !== current.session?.id)
      return fail("scope_changed", "登录状态已改变。", 409);
    return response.workspaces as Workspace[];
  }
  async function login(email: string, password: string) {
    if (!text(email.trim(), 320) || !text(password, 4096)) return fail("invalid_credentials", "请输入邮箱和密码。", 400);
    const issuer = config().url;
    const reserved = await tx(current => {
      assertIssuer(current);
      current.session = null; current.workspaceId = null; current.issuer = issuer;
      current.mode = "local"; current.generation++;
      return { result: current.generation, write: true };
    });
    const authenticated = session(await request("/auth/v1/token?grant_type=password", { body: { email: email.trim(), password } }));
    await tx(current => {
      if (current.generation !== reserved) return fail("scope_changed", "本次登录已取消或被替换。", 409);
      current.session = authenticated;
      return { result: null, write: true };
    });
    const workspaces = await listWorkspaces();
    const selected = env.EDUPI_WORKSPACE_ID?.trim();
    if (selected) await selectWorkspace(selected);
    return { state: await state(), workspaces };
  }
  async function selectWorkspace(workspaceId: string) {
    if (!UUID.test(workspaceId)) return fail("invalid_workspace", "工作区 ID 无效。", 400);
    const current = await ensureSession();
    const available = await listWorkspaces();
    if (!available.some(item => item.id === workspaceId)) return fail("workspace_forbidden", "无权访问此工作区。", 403);
    return tx(latest => {
      if (latest.generation !== current.generation || latest.session?.id !== current.session?.id)
        return fail("scope_changed", "登录状态已改变。", 409);
      latest.workspaceId = workspaceId; latest.mode = "cloud"; latest.generation++;
      return { result: structuredClone(latest), write: true };
    });
  }
  async function persistMode(mode: EduPiCloudMode) {
    const captured = mode === "cloud" ? await ensureSession() : null;
    if (captured) {
      const available = await listWorkspaces();
      if (!available.some(item => item.id === captured.workspaceId)) return fail("workspace_required", "请选择可访问的工作区。", 409);
    }
    return tx(current => {
      if (captured && (current.generation !== captured.generation || current.session?.id !== captured.session?.id))
        return fail("scope_changed", "登录状态已改变。", 409);
      current.mode = mode; current.generation++;
      return { result: structuredClone(current), write: true };
    });
  }
  async function logout() {
    const previous = await tx(current => {
      const removed = structuredClone(current);
      current.session = null; current.workspaceId = null; current.mode = "local"; current.issuer = null; current.generation++;
      return { result: removed, write: true };
    });
    if (previous.session?.accessToken && previous.issuer === config().url) {
      try { await request("/auth/v1/logout?scope=local", { body: {}, token: previous.session.accessToken }); }
      catch { /* Local credentials are already removed. */ }
    }
    return state();
  }
  async function operation(operationName: string, body: Record<string, unknown> = {}, scope?: CloudScope) {
    const selected = scope || await captureScope();
    await assertScope(selected);
    const authenticated = await ensureSession();
    await assertScope(selected);
    const response = await request(`/functions/v1/${EDGE_OPERATIONS[operationName] || "edupi-core-broker"}`, {
      token: authenticated.session!.accessToken, workspaceId: selected.workspaceId,
      body: EDGE_OPERATIONS[operationName] && operationName !== "runtime"
        ? body : { ...body, operation: operationName },
    });
    await assertScope(selected);
    if (["students", "entities", "sessions"].includes(operationName)) {
      try { assertCloudSyncContract(response); }
      catch { return fail("unsupported_contract", "云端同步接口版本与当前客户端不匹配。", 502); }
    }
    return response;
  }
  async function dashboard(selected?: CloudScope): Promise<EduPiMobileDashboardResponse> {
    const scope = selected || await captureScope();
    await flushOutbox();
    const response = await operation("mobile-dashboard", {}, scope);
    try { assertMobileDashboardContract(response); }
    catch (error) {
      if (error instanceof EduPiCloudContractError) return fail(error.code, error.message, 502);
      return fail("invalid_response", "云端首页数据格式无效。", 502);
    }
    if (response.payload.workspace_id !== scope.workspaceId) return fail("workspace_mismatch", "云端工作区不匹配。", 409);
    return response;
  }
  async function prepare(operationName: string, body: Record<string, unknown>, scope: CloudScope): Promise<
    EduPiCloudOutboxEntry | { completed: Record<string, unknown> }
  > {
    await assertScope(scope);
    const envelope = record(body.envelope);
    const requestId = operationName === "command" ? envelope?.request_id : body.request_id;
    if (!text(requestId) || !["command", "task-command", "intake-command", "education-facts",
      "material-metadata", "material-intake", "students", "entities", "sessions", "classroom", "student-events"].includes(operationName))
      return fail("invalid_request", "同步写入必须包含固定请求 ID。", 400);
    const key = { issuer: scope.issuer, accountId: scope.accountId, workspaceId: scope.workspaceId,
      operation: operationName, requestId };
    const fingerprint = digest(body);
    return tx<EduPiCloudOutboxEntry | { completed: Record<string, unknown> }>(current => {
      if (current.generation !== scope.generation || current.workspaceId !== scope.workspaceId
        || current.session?.user.id !== scope.accountId || current.issuer !== scope.issuer)
        return fail("scope_changed", "工作区已改变。", 409);
      const id = digest(key);
      const existing = current.outbox.find(item => item.id === id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return fail("idempotency_conflict", "相同请求 ID 的内容不同。", 409);
        return { result: structuredClone(existing) };
      }
      const completed = current.completed.find(item => item.entry.id === id);
      if (completed) {
        if (completed.entry.fingerprint !== fingerprint) return fail("idempotency_conflict", "相同请求 ID 的内容不同。", 409);
        return { result: { completed: structuredClone(completed.result) } };
      }
      if (current.outbox.length >= 256) return fail("outbox_full", "待同步队列已满，请先处理已有记录。", 409);
      const entry: EduPiCloudOutboxEntry = { id, ...key, fingerprint, operation: operationName,
        body: structuredClone(body), createdAt: new Date(now()).toISOString(), attempts: 0, lastError: null, status: "pending" };
      current.outbox.push(entry);
      return { result: structuredClone(entry), write: true };
    });
  }
  async function deliver(entry: EduPiCloudOutboxEntry, scope: CloudScope) {
    const key = `${stateDir || "default"}:${entry.id}`;
    const running = deliveries.get(key);
    if (running) return running;
    const pending = (async () => {
      try {
        if (entry.issuer !== scope.issuer || entry.accountId !== scope.accountId || entry.workspaceId !== scope.workspaceId)
          return fail("workspace_mismatch", "待同步记录属于其他账号或工作区。", 409);
        let operationName = entry.operation;
        let body = entry.body;
        if (entry.operation === "task-command") {
          operationName = "command";
          if (!body.envelope) {
            const currentSnapshot = await snapshot(scope);
            const envelope = buildCloudTaskEnvelope({
              snapshotId: String(currentSnapshot.snapshot_id), command: body.command,
              requestId: String(body.request_id), idempotencyKey: String(body.idempotency_key),
            });
            body = await tx(current => {
              if (current.generation !== scope.generation) return fail("scope_changed", "工作区已改变。", 409);
              const durable = current.outbox.find(item => item.id === entry.id);
              if (!durable) return fail("outbox_missing", "待同步记录已改变。", 409);
              // Persist the exact envelope before the first network write. Later
              // attempts reuse every byte, including snapshot, time and message ID.
              durable.body.envelope ||= envelope;
              return { result: structuredClone(durable.body), write: true };
            });
            entry.body = body;
          }
          body = { envelope: body.envelope };
        }
        if (entry.operation === "intake-command") {
          operationName = "command";
          if (!body.envelope) {
            const currentSnapshot = await snapshot(scope);
            const envelope = buildCloudIntakeEnvelope({
              snapshotId: String(currentSnapshot.snapshot_id),
              command: body.command as never,
              storageObjectKey: typeof body.storage_object_key === "string" ? body.storage_object_key : undefined,
              requestId: String(body.request_id),
              idempotencyKey: String(body.idempotency_key),
            });
            body = await tx(current => {
              if (current.generation !== scope.generation) return fail("scope_changed", "工作区已改变。", 409);
              const durable = current.outbox.find(item => item.id === entry.id);
              if (!durable) return fail("outbox_missing", "待同步记录已改变。", 409);
              durable.body.envelope ||= envelope;
              return { result: structuredClone(durable.body), write: true };
            });
            entry.body = body;
          }
          body = { envelope: body.envelope };
        }
        let result: Record<string, unknown>;
        if (entry.operation === "material-intake") {
          result = await deliverMaterialIntake(entry, body, scope);
        } else {
          result = await operation(operationName, body, scope);
          await verifyCloudWrite(operationName, body, result, scope.workspaceId,
            (op, body) => operation(op, body, scope));
        }
        await assertScope(scope);
        await tx(current => {
          if (current.generation !== scope.generation) return fail("scope_changed", "工作区已改变。", 409);
          current.outbox = current.outbox.filter(item => item.id !== entry.id);
          current.completed = [
            ...current.completed.filter(item => item.entry.id !== entry.id),
            { entry: structuredClone(entry), result: structuredClone(result) },
          ];
          return { result: null, write: true };
        });
        if (entry.operation === "material-intake") await settleCompletedMaterials(scope);
        return result;
      } catch (error) {
        await tx(current => {
          const item = current.outbox.find(candidate => candidate.id === entry.id);
          if (item) {
            item.attempts++;
            item.lastError = error instanceof EduPiCloudError ? error.code
              : error instanceof CloudReadbackConflictError ? "readback_conflict" : "readback_unverified";
            if (error instanceof CloudReadbackConflictError
              || error instanceof EduPiCloudError && error.status === 409 && error.code !== "scope_changed") item.status = "conflict";
            else if (error instanceof EduPiCloudError && error.status >= 400 && error.status < 500
              && error.code !== "scope_changed" && ![401, 403, 429].includes(error.status)) item.status = "failed";
          }
          return { result: null, write: Boolean(item) };
        });
        throw error;
      }
    })();
    deliveries.set(key, pending);
    try { return await pending; } finally { if (deliveries.get(key) === pending) deliveries.delete(key); }
  }
  async function settleCompletedMaterials(scope: CloudScope) {
    const current = await assertScope(scope);
    const completed = current.completed.filter(item => item.entry.operation === "material-intake"
      && item.entry.issuer === scope.issuer && item.entry.accountId === scope.accountId
      && item.entry.workspaceId === scope.workspaceId && item.result.upload_verified === true
      && item.result.staging_settled !== true);
    if (!completed.length) return;
    const { listStagedMaterials, settleStagedMaterial } = await import("./edupi-material-staging.ts");
    for (const item of completed) {
      await assertScope(scope);
      const descriptor = record(item.entry.body.staging);
      let settled = false;
      try {
        if (!descriptor || typeof descriptor.staging_id !== "string") throw new Error("invalid_staging");
        const staged = listStagedMaterials({ stateDir }).find(row => row.staging_id === descriptor.staging_id);
        if (staged && (staged.source_hash !== descriptor.source_hash
          || staged.staging_path !== descriptor.staging_path
          || staged.expected_size_bytes !== descriptor.expected_size_bytes)) throw new Error("staging_changed");
        settleStagedMaterial(descriptor.staging_id, "accepted_receipt", { stateDir });
        settled = true;
      } catch { /* The durable receipt retains an independently retryable settlement. */ }
      await tx(latest => {
        const row = latest.completed.find(row => row.entry.id === item.entry.id);
        if (!row) return { result: null };
        row.result.staging_settled = settled;
        return { result: null, write: true };
      });
    }
  }
  async function deliverMaterialIntake(entry: EduPiCloudOutboxEntry, body: Record<string, unknown>, scope: CloudScope): Promise<Record<string, unknown>> {
    const { readVerifiedStagedMaterial } = await import("./edupi-material-recognition.ts");
    const descriptor = record(body.staging) as MaterialStagingDescriptor | null;
    const command = record(body.command) as EducationIntakeCommand | null;
    if (!descriptor || !command || command.command_type !== "intake_material"
      || typeof body.request_id !== "string" || typeof body.idempotency_key !== "string") {
      return fail("invalid_request", "云端材料接入请求无效。", 400);
    }
    let verified: { bytes: Buffer; extension: string };
    try {
      verified = await readVerifiedStagedMaterial(descriptor);
    } catch {
      return fail("staging_unavailable", "暂存材料无法读取，材料仍保留在待接入列表。", 409);
    }
    const material = record(command.material);
    if (!material || verified.bytes.byteLength !== Number(body.size_bytes)
      || material.source_hash !== body.sha256
      || descriptor.source_hash !== body.sha256
      || descriptor.expected_size_bytes !== Number(body.size_bytes)) {
      return fail("staging_integrity_conflict", "暂存材料已变化，请重新上传。", 409);
    }
    const verifyUpload = async (objectKey: string) => edgeRequest("edupi-materials", {
      body: {
        action: "verify_upload",
        request_id: body.request_id,
        material_id: body.material_id,
        file_name: body.file_name,
        content_type: body.content_type,
        size_bytes: body.size_bytes,
        sha256: body.sha256,
        object_key: objectKey,
      },
    }, scope);
    let existingUpload: Record<string, unknown> | null = null;
    if (typeof body.object_key === "string") {
      try {
        const existing = await verifyUpload(body.object_key);
        if (existing.verified !== true || existing.object_key !== body.object_key
          || existing.sha256 !== body.sha256 || existing.size_bytes !== body.size_bytes) {
          return fail("material_integrity_conflict", "云端材料二进制核对失败，材料仍保留。", 409);
        }
        existingUpload = existing;
      } catch (error) {
        if (!(error instanceof EduPiCloudError) || error.code !== "material_not_uploaded") throw error;
      }
    }
    const uploadResponse = existingUpload || await edgeRequest("edupi-materials", {
      body: {
        action: "create_upload",
        request_id: body.request_id,
        material_id: body.material_id,
        file_name: body.file_name,
        content_type: body.content_type,
        size_bytes: body.size_bytes,
        sha256: body.sha256,
        ...(typeof body.object_key === "string" ? { object_key: body.object_key } : {}),
      },
    }, scope);
    const token = typeof uploadResponse.token === "string" && uploadResponse.token.length > 0 && uploadResponse.token.length <= 4000
      ? uploadResponse.token : null;
    const objectKey = typeof uploadResponse.object_key === "string" && uploadResponse.object_key.length > 0 && uploadResponse.object_key.length <= 500
      ? uploadResponse.object_key : null;
    if (!existingUpload && !token || !objectKey || uploadResponse.external_send !== false) {
      return fail("invalid_response", "云端材料上传地址无效。", 502);
    }
    if (body.object_key && body.object_key !== objectKey) {
      return fail("material_integrity_conflict", "云端材料对象身份发生变化。", 409);
    }
    if (!body.envelope) {
      const currentSnapshot = await snapshot(scope);
      const envelope = buildCloudIntakeEnvelope({
        snapshotId: String(currentSnapshot.snapshot_id),
        command,
        storageObjectKey: objectKey,
        requestId: String(body.request_id),
        idempotencyKey: String(body.idempotency_key),
      });
      body = await tx(current => {
        if (current.generation !== scope.generation) return fail("scope_changed", "工作区已改变。", 409);
        const durable = current.outbox.find(item => item.id === entry.id);
        if (!durable) return fail("outbox_missing", "待同步材料记录已改变。", 409);
        durable.body.object_key ||= objectKey;
        durable.body.envelope ||= envelope;
        return { result: structuredClone(durable.body), write: true };
      });
      entry.body = body;
    }
    let alreadyVerified = existingUpload !== null;
    if (!alreadyVerified) {
      try {
        const existing = await verifyUpload(objectKey);
        alreadyVerified = existing.verified === true && existing.object_key === objectKey
          && existing.sha256 === body.sha256 && existing.size_bytes === body.size_bytes;
      } catch (error) {
        if (!(error instanceof EduPiCloudError) || error.code !== "material_not_uploaded") throw error;
      }
    }
    if (!alreadyVerified) {
      if (!token) return fail("invalid_response", "云端材料上传地址无效。", 502);
      let putSucceeded = false;
      const configValue = config();
      const encodedPath = objectKey.split("/").map(segment => encodeURIComponent(segment)).join("/");
      try {
        const uploaded = await transport(
          `${configValue.url}/storage/v1/object/upload/sign/edupi-materials/${encodedPath}?token=${encodeURIComponent(token)}`,
          {
            method: "PUT", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
            headers: { "Content-Type": String(body.content_type) }, body: Buffer.from(verified.bytes),
          },
        );
        putSucceeded = uploaded.ok;
      } catch {
        putSucceeded = false;
      }
      try {
        const confirmed = await verifyUpload(objectKey);
        if (confirmed.verified !== true || confirmed.object_key !== objectKey
          || confirmed.sha256 !== body.sha256 || confirmed.size_bytes !== body.size_bytes) {
          return fail("material_integrity_conflict", "云端材料二进制核对失败，材料仍保留。", 409);
        }
      } catch (error) {
        if (error instanceof EduPiCloudError && error.code === "material_integrity_conflict") throw error;
        if (!putSucceeded) return fail("network_unavailable", "材料上传未完成，材料仍保留。");
        return fail("material_upload_unverified", "材料上传尚未通过二进制核对，材料仍保留。", 503);
      }
    }
    const commandResult = await operation("command", { envelope: body.envelope }, scope);
    await verifyCloudWrite("command", { envelope: body.envelope }, commandResult, scope.workspaceId,
      (op, readBody) => operation(op, readBody, scope));
    return {
      ok: true, operation: "material-intake", request_id: body.request_id,
      object_key: objectKey, upload_verified: true, response: commandResult,
      replayed: commandResult.replayed === true, external_send: false,
    };
  }
  async function waitingForSessionCreation(entry: EduPiCloudOutboxEntry, scope: CloudScope): Promise<boolean> {
    if (entry.operation !== "sessions" || entry.body.action === "create") return false;
    const current = await assertScope(scope);
    return current.outbox.some(parent => parent.operation === "sessions" && parent.body.action === "create"
      && parent.issuer === entry.issuer && parent.accountId === entry.accountId && parent.workspaceId === entry.workspaceId
      && parent.body.session_id === entry.body.session_id);
  }
  async function operationWithOutbox(operationName: string, body: Record<string, unknown>, scope?: CloudScope) {
    const selected = scope || await captureScope();
    const prepared = await prepare(operationName, body, selected);
    if ("completed" in prepared) {
      if (operationName === "material-intake") await settleCompletedMaterials(selected);
      return { queued: false as const, result: prepared.completed };
    }
    const entry = prepared;
    // A brief recovery between these requests must not send the first prompt
    // before its session exists, turning a recoverable offline send into a 404.
    if (await waitingForSessionCreation(entry, selected)) return { queued: true as const, entry };
    try { return { queued: false as const, result: await deliver(entry, selected) }; }
    catch (error) {
      if (error instanceof CloudReadbackError || error instanceof EduPiCloudError
        && (error.status >= 500 || [401, 429].includes(error.status)))
        return { queued: true as const, entry };
      throw error;
    }
  }
  async function flushOutbox() {
    const current = await state();
    if (current.mode !== "cloud" || !current.session || !current.workspaceId)
      return { flushed: 0, pending: current.outbox.length };
    const scope = await captureScope();
    await settleCompletedMaterials(scope);
    let flushed = 0;
    for (const entry of current.outbox.filter(item => item.issuer === scope.issuer && item.accountId === scope.accountId
      && item.workspaceId === scope.workspaceId && item.status === "pending")) {
      try {
        if (await waitingForSessionCreation(entry, scope)) continue;
        await deliver(entry, scope); flushed++;
      }
      catch (error) {
        // A single object's conflict must not starve independent saved writes.
        // Stop only when the whole connection or authenticated scope is unusable.
        if (error instanceof EduPiCloudError
          && (error.code === "scope_changed" || error.status >= 500 || [401, 403, 429].includes(error.status))) break;
      }
    }
    return { flushed, pending: (await state()).outbox.length };
  }
  async function snapshot(selected?: CloudScope) {
    const scope = selected || await captureScope();
    const response = await operation("snapshot", {}, scope);
    if (response.ok !== true || response.operation !== "snapshot" || response.external_send !== false
      || record(response.payload)?.workspace_id !== scope.workspaceId
      || !text(response.snapshot_id) || !text(response.state_hash)
      || !/^sha256:[a-f0-9]{64}$/u.test(String(response.state_hash)))
      return fail("invalid_response", "云端快照身份无效。", 502);
    await tx(current => {
      if (current.generation !== scope.generation) return fail("scope_changed", "工作区已改变。", 409);
      current.cursors[digest({ issuer: scope.issuer, accountId: scope.accountId, workspaceId: scope.workspaceId })] = {
        snapshotId: String(response.snapshot_id), stateHash: String(response.state_hash), readAt: new Date(now()).toISOString(),
      };
      return { result: null, write: true };
    });
    return response;
  }
  async function taskCommand(command: unknown, identity: { requestId: string; idempotencyKey: string }, selected?: CloudScope) {
    // Validate locally without needing a connection. Only the intent is queued;
    // its snapshot-bound envelope is created durably when the connection returns.
    const validated = buildCloudTaskEnvelope({ snapshotId: "pending-cloud-snapshot", command, ...identity }).command;
    return operationWithOutbox("task-command", {
      request_id: identity.requestId, idempotency_key: identity.idempotencyKey, command: validated,
    }, selected);
  }
  async function intakeCommand(command: unknown, identity: {
    requestId: string; idempotencyKey: string; storageObjectKey?: string;
  }, selected?: CloudScope) {
    const validated = record(command);
    if (!validated || typeof validated.command_type !== "string"
      || !["import_calendar", "import_timetable", "intake_material"].includes(validated.command_type)) {
      return fail("unsupported_command", "云端暂不支持此教育导入。", 400);
    }
    return operationWithOutbox("intake-command", {
      request_id: identity.requestId,
      idempotency_key: identity.idempotencyKey,
      command: structuredClone(command),
      ...(identity.storageObjectKey ? { storage_object_key: identity.storageObjectKey } : {}),
    }, selected);
  }
  async function edgeRequest(name: string, init: { method?: string; body?: unknown; query?: string } = {}, selected?: CloudScope) {
    if (!["edupi-student-events", "edupi-classroom", "edupi-materials"].includes(name)) {
      return fail("invalid_request", "云端接口无效。", 400);
    }
    const scope = selected || await captureScope();
    const current = await ensureSession();
    await assertScope(scope);
    const response = await request(`/functions/v1/${name}${init.query || ""}`,
      { token: current.session!.accessToken, workspaceId: scope.workspaceId, body: init.body });
    await assertScope(scope);
    return response;
  }
  async function uploadMaterial(input: {
    materialId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    bytes: Uint8Array;
    staging?: MaterialStagingDescriptor;
    command?: EducationIntakeCommand;
    requestId?: string;
    idempotencyKey?: string;
  }, selected?: CloudScope) {
    const scope = selected || await captureScope();
    if (input.staging && input.command && input.requestId && input.idempotencyKey) {
      const durable = await operationWithOutbox("material-intake", {
        request_id: input.requestId,
        idempotency_key: input.idempotencyKey,
        material_id: input.materialId,
        file_name: input.fileName,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        sha256: input.sha256,
        staging: structuredClone(input.staging),
        command: structuredClone(input.command),
      }, scope);
      return durable;
    }
    const response = await edgeRequest("edupi-materials", {
      body: {
        action: "create_upload",
        material_id: input.materialId,
        file_name: input.fileName,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        sha256: input.sha256,
      },
    }, scope);
    const token = typeof response.token === "string" && response.token.length > 0 && response.token.length <= 4000
      ? response.token : null;
    const objectKey = typeof response.object_key === "string" && response.object_key.length > 0 && response.object_key.length <= 500
      ? response.object_key : null;
    if (!token || !objectKey || response.external_send !== false) {
      return fail("invalid_response", "云端材料上传地址无效。", 502);
    }
    const configValue = config();
    const encodedPath = objectKey.split("/").map(segment => encodeURIComponent(segment)).join("/");
    let uploaded: Response;
    try {
      uploaded = await transport(
        `${configValue.url}/storage/v1/object/upload/sign/edupi-materials/${encodedPath}?token=${encodeURIComponent(token)}`,
        {
          method: "PUT",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
          headers: { "Content-Type": input.contentType },
          body: Buffer.from(input.bytes),
        },
      );
    } catch {
      return fail("network_unavailable", "材料上传未完成，暂存文件仍保留。");
    }
    if (!uploaded.ok) return fail("material_upload_failed", "材料上传未完成，暂存文件仍保留。", 503);
    const verifiedUpload = await edgeRequest("edupi-materials", {
      body: {
        action: "verify_upload",
        material_id: input.materialId,
        file_name: input.fileName,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        sha256: input.sha256,
        object_key: objectKey,
      },
    }, scope);
    if (verifiedUpload.verified !== true || verifiedUpload.object_key !== objectKey
      || verifiedUpload.sha256 !== input.sha256 || verifiedUpload.size_bytes !== input.sizeBytes) {
      return fail("material_upload_unverified", "材料上传尚未通过二进制核对，材料仍保留。", 503);
    }
    await assertScope(scope);
    return { objectKey, token, uploadVerified: true as const, externalSend: false as const };
  }
  return {
    state, captureScope, assertScope, runtimeDirectory: () => cloudRuntimeDirectory(stateDir),
    persistMode, login, refresh: () => refresh(), logout, listWorkspaces, selectWorkspace, dashboard,
    config: () => { const current = config(); return { url: current.url, configured: Boolean(current.anonKey) }; },
    snapshot, taskCommand, intakeCommand, uploadMaterial, operation, operationWithOutbox, flushOutbox, outbox: async () => (await state()).outbox,
    edge: edgeRequest,
  };
}
