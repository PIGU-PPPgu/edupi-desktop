import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isZhixueFlowId, type ZhixueFlowStatus, type ZhixueLoginPhase, type ZhixueReceipt, type ZhixueSyncPhase } from "./edupi-zhixue-status";

type LoginState = {
  version: 1;
  flowId: string;
  status: Exclude<ZhixueLoginPhase, "not_started">;
  pid?: number;
  qrPath?: string;
  startedAt?: string;
  authenticatedAt?: string;
  updatedAt?: string;
  error?: string;
};

type SyncState = {
  version: 1;
  flowId: string;
  loginFlowId?: string;
  status: "running" | "ok" | "needs_login" | "failed";
  completeness?: "empty" | "base_performance";
  month?: string;
  config?: Record<string, unknown>;
  counts?: { reports?: number; students?: number };
  message?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
};

type SyncConfig = {
  className: string;
  subjectCode: string;
  phaseCode: string;
  gradeCode?: string;
  schoolId?: string;
  classId?: string;
};

function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

function atomicJson(path: string, value: unknown): void {
  privateDir(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function alive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function textResult(text: string, details?: unknown, options: { isError?: boolean; terminate?: boolean } = {}): AgentToolResult<unknown> {
  return {
    content: [{ type: "text" as const, text }],
    details,
    ...(options.isError ? { isError: true } : {}),
    ...(options.terminate ? { terminate: true } : {}),
  };
}

function layout(projectRoot: string) {
  const root = resolve(projectRoot, ".edupi", "zhixue");
  return {
    root,
    state: resolve(root, "login-state.json"),
    lock: resolve(root, "login.lock"),
    session: resolve(root, "session.json"),
    loginOk: resolve(root, "login_ok.json"),
    qr: resolve(root, "login-qr.png"),
    profile: resolve(root, "profile"),
    config: resolve(root, "sync-config.json"),
    syncState: resolve(root, "sync-state.json"),
    syncSnapshot: resolve(root, "sync-snapshot.json"),
    syncLock: resolve(root, "sync.lock"),
    browserLock: resolve(root, "browser.lock"),
  };
}

function current(layoutValue: ReturnType<typeof layout>, read = readJson): LoginState | null {
  const state = read<LoginState>(layoutValue.state);
  if (!state || state.status !== "authenticated") return state;
  const session = read<{ flowId?: string }>(layoutValue.session);
  const loginOk = read<{ flowId?: string }>(layoutValue.loginOk);
  if (session?.flowId !== state.flowId || loginOk?.flowId !== state.flowId) {
    return { ...state, status: "error", error: "登录回执与当前登录 flow 不一致，请重新扫码。" };
  }
  if (syncForLogin(layoutValue, state.flowId, read)?.status === "needs_login") {
    return { ...state, status: "needs_login" };
  }
  return state;
}

function syncForLogin(paths: ReturnType<typeof layout>, loginFlowId: string, read = readJson): SyncState | null {
  const state = read<SyncState>(paths.syncState);
  return state?.version === 1 && state.loginFlowId === loginFlowId ? state : null;
}

function busy(layoutValue: ReturnType<typeof layout>): boolean {
  const state = readJson<{ flowId?: string; pid?: number; startedAt?: string }>(layoutValue.lock);
  if (!state) {
    try {
      if (Date.now() - statSync(layoutValue.lock).mtimeMs < 30_000) return true;
    } catch {}
    try { unlinkSync(layoutValue.lock); } catch {}
    return false;
  }
  if (alive(state.pid)) return true;
  if (typeof state.pid === "number" && state.pid > 0) {
    try { unlinkSync(layoutValue.lock); } catch {}
    return false;
  }
  try {
    if (Date.now() - statSync(layoutValue.lock).mtimeMs < 30_000) return true;
  } catch {}
  try { unlinkSync(layoutValue.lock); } catch {}
  return false;
}

function visual(layoutValue: ReturnType<typeof layout>, state: LoginState | null) {
  if (state?.status !== "awaiting_scan" || state.qrPath !== layoutValue.qr) return undefined;
  try {
    const qr = lstatSync(layoutValue.qr);
    if (!qr.isFile() || qr.isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }
  return { visual: { kind: "qr", title: "智学网登录", path: layoutValue.qr } };
}

function claimLock(path: string, value: unknown): boolean {
  privateDir(dirname(path));
  try {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    } finally {
      closeSync(descriptor);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function syncBusy(layoutValue: ReturnType<typeof layout>): boolean {
  const lock = readJson<{ pid?: number }>(layoutValue.syncLock);
  if (!lock) return false;
  if (alive(lock.pid)) return true;
  try { unlinkSync(layoutValue.syncLock); } catch {}
  return false;
}

function browserBusy(layoutValue: ReturnType<typeof layout>): boolean {
  const lock = readJson<{ pid?: number }>(layoutValue.browserLock);
  if (!lock) return false;
  if (alive(lock.pid)) return true;
  try {
    if (Date.now() - statSync(layoutValue.browserLock).mtimeMs < 30_000) return true;
  } catch {}
  try { unlinkSync(layoutValue.browserLock); } catch {}
  return false;
}

function writeLoginFailure(layoutValue: ReturnType<typeof layout>, flowId: string, message: string): void {
  const state = readJson<LoginState>(layoutValue.state);
  if (state?.flowId === flowId && ["starting", "awaiting_scan"].includes(state.status)) {
    atomicJson(layoutValue.state, { ...state, status: "error", error: message, updatedAt: new Date().toISOString() });
  }
}

function writeSyncFailure(layoutValue: ReturnType<typeof layout>, flowId: string, message: string): void {
  const state = readJson<SyncState>(layoutValue.syncState);
  if (state?.flowId === flowId && state.status === "running") {
    atomicJson(layoutValue.syncState, { ...state, status: "failed", error: message, updatedAt: new Date().toISOString() });
  }
}

function validSyncConfig(value: unknown): value is SyncConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return typeof config.className === "string" && config.className.trim().length > 0
    && typeof config.subjectCode === "string" && /^\d+$/.test(config.subjectCode)
    && typeof config.phaseCode === "string" && /^\d+$/.test(config.phaseCode)
    && (config.gradeCode === undefined || (typeof config.gradeCode === "string" && /^\d+$/.test(config.gradeCode)))
    && (config.schoolId === undefined || typeof config.schoolId === "string")
    && (config.classId === undefined || typeof config.classId === "string");
}

function validMonth(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

function syncText(state: SyncState | null, config: SyncConfig | null): string {
  if (!state) {
    return config
      ? `还没有同步记录，已准备同步 ${config.className}。`
      : "还没有同步配置，请先提供班级、学科和学段。";
  }
  if (state.status === "running") return state.message || `正在同步 ${state.month ?? "目标月份"}，完成后再读取结果。`;
  if (state.status === "needs_login") return "智学网登录已失效，请重新扫码。";
  if (state.status === "ok") {
    const reports = state.counts?.reports ?? 0;
    const students = state.counts?.students ?? 0;
    return state.message || `同步完成：${reports} 份作业，${students} 名学生。`;
  }
  return `智学网同步失败：${state.error || "未知错误"}。`;
}

function releaseLockForFlow(path: string, flowId: string): void {
  const lock = readJson<{ flowId?: string }>(path);
  if (lock?.flowId === flowId) {
    try { unlinkSync(path); } catch {}
  }
}

function statusText(state: LoginState | null, sync?: ZhixueSyncPhase): string {
  if (!state) return "还没有发起智学网登录。";
  if (state.status === "awaiting_scan") return "等待扫码。请用智学网教师端 App 扫码。";
  if (state.status === "starting") return "登录窗口正在启动，请稍等。";
  if (state.status === "authenticated") {
    if (sync === "needs_config") return "智学网登录已完成，但同步前还需要班级、学科和学段。";
    if (sync === "ready") return "智学网登录已完成，可以开始同步。";
    return `智学网登录已完成（${state.authenticatedAt ?? "时间未知"}）。`;
  }
  if (state.status === "needs_login") return "智学网登录已失效，请重新扫码。";
  if (state.status === "expired") return "扫码等待已超时，请重新发起登录。";
  return `智学网登录失败：${state.error ?? "未知错误"}。`;
}

function statusDetails(paths: ReturnType<typeof layout>, state: LoginState | null, sync?: ZhixueSyncPhase) {
  const zhixue: ZhixueReceipt = { version: 1, status: state?.status ?? "not_started", flowId: state?.flowId ?? null, ...(sync ? { sync } : {}) };
  return { ...visual(paths, state), zhixue };
}

function syncPhase(state: SyncState | null, hasConfig: boolean): ZhixueSyncPhase {
  if (!state) return hasConfig ? "ready" : "needs_config";
  if (state.status === "needs_login") return "failed";
  return state.status === "ok" && state.completeness === "empty" ? "empty" : state.status;
}

function loginFailed(state: LoginState | null): boolean {
  return state?.status === "expired" || state?.status === "error" || state?.status === "needs_login";
}

// Chrome's startup, page, token and QR waits have separate deadlines.
const LOGIN_QR_STARTUP_WAIT_MS = 120_000;
// The worker gives the teacher 15 minutes to scan, plus time for the last status request.
const LOGIN_SCAN_WAIT_MS = 16 * 60_000;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function readBoundedFile(file: string, limit: number): Buffer | null {
  let fd: number | undefined;
  try {
    if (!lstatSync(file).isFile()) return null;
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) return null;
    // The worker replaces JSON atomically. A fixed-size read also bounds a file that grows after stat.
    const bytes = Buffer.alloc(stat.size + 1);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    return size === stat.size ? bytes.subarray(0, size) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readStatusJson<T>(file: string): T | null {
  const bytes = readBoundedFile(file, 1_048_576);
  try { return bytes ? JSON.parse(bytes.toString("utf8")) as T : null; } catch { return null; }
}

function expiredLogin(state: LoginState, waitMs: number): boolean {
  const timestamp = state.status === "starting" ? state.startedAt : state.updatedAt;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return false;
  return Date.now() - Date.parse(timestamp) >= waitMs;
}

/** A desktop caller may read only the safe projection of its exact login flow. */
export function readEduPiZhixueLoginStatus(projectRoot: string, flowId: string): ZhixueFlowStatus {
  if (!isZhixueFlowId(flowId)) return { status: "not_current" };
  const paths = layout(projectRoot);
  try {
    if (!lstatSync(dirname(paths.root)).isDirectory() || !lstatSync(paths.root).isDirectory()) return { status: "error" };
  } catch {
    return { status: "not_current" };
  }
  const observed = current(paths, readStatusJson);
  if (observed?.version !== 1 || observed.flowId !== flowId) return { status: "not_current" };
  const qr = observed.status === "awaiting_scan" && observed.qrPath === paths.qr
    ? readBoundedFile(paths.qr, 262_144) : null;
  // The worker can finish or replace the image while we read it. The second
  // observation wins and cannot serve a different login's QR.
  const state = observed.status === "awaiting_scan" ? current(paths, readStatusJson) : observed;
  if (state?.version !== 1 || state.flowId !== flowId) return { status: "not_current" };
  switch (state.status) {
    case "authenticated": {
      const config = readStatusJson(paths.config);
      return { status: state.status, needsSyncConfig: !validSyncConfig(config) };
    }
    case "starting":
      return { status: expiredLogin(state, LOGIN_QR_STARTUP_WAIT_MS + 15_000) ? "error" : state.status };
    case "awaiting_scan":
      if (expiredLogin(state, LOGIN_SCAN_WAIT_MS)) return { status: "expired" };
      return qr?.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        ? { status: state.status, qr: qr.toString("base64") }
        : { status: state.status };
    case "needs_login":
    case "expired":
    case "error":
      return { status: state.status };
    default:
      return { status: "error" };
  }
}

export function createEduPiZhixueTools(projectRoot: string, workerPath: string, syncWorkerPath = workerPath) {
  const paths = layout(projectRoot);
  privateDir(paths.root);
  const login = defineTool({
    name: "zhixue_login",
    label: "智学网扫码登录",
    description: "打开一次隔离的 Chrome 登录窗口并显示二维码。扫码成功后由本地 worker 读取服务端 token，写入当前用户自己的登录态。一次请求只允许启动一次。",
    promptSnippet: "zhixue_login: 显示二维码，等待老师扫码，不重复弹窗",
    parameters: Type.Object({}),
    executionMode: "sequential" as const,
    execute: async () => {
      const flowId = randomUUID();
      privateDir(paths.root);
      if (busy(paths) || browserBusy(paths)
        || !claimLock(paths.lock, { version: 1, flowId, startedAt: new Date().toISOString(), pid: 0 })
        || !claimLock(paths.browserLock, { version: 1, flowId, startedAt: new Date().toISOString(), pid: 0 })) {
        try { releaseLockForFlow(paths.lock, flowId); } catch {}
        return textResult("智学网登录窗口已经在运行，请完成当前扫码，不要再次弹窗。", statusDetails(paths, current(paths)), { terminate: true });
      }
      atomicJson(paths.state, { version: 1, flowId, status: "starting", startedAt: new Date().toISOString() });
      const child = spawn(process.execPath, [
        workerPath, "--root", paths.root, "--flow-id", flowId, "--state", paths.state,
        "--session", paths.session, "--qr", paths.qr, "--profile", paths.profile,
        "--browser-lock", paths.browserLock,
      ], { cwd: paths.root, detached: true, stdio: "ignore", env: { ...process.env } });
      if (!child.pid) {
        // spawn reports its specific error asynchronously even if it has no PID.
        child.once("error", () => {});
        writeLoginFailure(paths, flowId, "登录进程启动失败。");
        releaseLockForFlow(paths.lock, flowId);
        releaseLockForFlow(paths.browserLock, flowId);
        return textResult("智学网登录进程启动失败。", statusDetails(paths, current(paths)), { isError: true, terminate: true });
      }
      let childExited = false;
      child.once("error", () => {
        writeLoginFailure(paths, flowId, "登录进程启动失败。");
        releaseLockForFlow(paths.lock, flowId);
        releaseLockForFlow(paths.browserLock, flowId);
      });
      child.once("exit", () => {
        childExited = true;
        releaseLockForFlow(paths.lock, flowId);
        releaseLockForFlow(paths.browserLock, flowId);
        writeLoginFailure(paths, flowId, "登录进程异常退出，请重新扫码。");
      });
      atomicJson(paths.lock, { version: 1, flowId, startedAt: new Date().toISOString(), pid: child.pid });
      if (childExited) releaseLockForFlow(paths.lock, flowId);
      child.unref();
      const deadline = Date.now() + LOGIN_QR_STARTUP_WAIT_MS;
      while (Date.now() < deadline) {
        const state = current(paths);
        if (state?.flowId === flowId && state.status !== "starting") {
          const sync = state.status === "authenticated" ? syncPhase(null, validSyncConfig(readJson(paths.config))) : undefined;
          return textResult(statusText(state, sync), statusDetails(paths, state, sync), {
            isError: loginFailed(state), terminate: state.status !== "authenticated",
          });
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      }
      const state = current(paths);
      return textResult("登录窗口已启动，请等待二维码出现；本条请求不会再次弹窗。",
        state?.flowId === flowId ? statusDetails(paths, state) : undefined, { terminate: true });
    },
  });
  const status = defineTool({
    name: "zhixue_login_status",
    label: "查看智学网登录状态",
    description: "只读读取当前登录 flow 的状态，不打开新窗口、不返回 token。",
    promptSnippet: "zhixue_login_status: 读取扫码回执，不重复弹窗",
    parameters: Type.Object({}),
    executionMode: "sequential" as const,
    execute: async () => {
      const state = current(paths);
      const sync = state?.status === "authenticated"
        ? syncPhase(syncForLogin(paths, state.flowId), validSyncConfig(readJson(paths.config)))
        : undefined;
      return textResult(statusText(state, sync), statusDetails(paths, state, sync), loginFailed(state)
        ? { isError: true, terminate: true }
        : {});
    },
  });
  const syncStatus = defineTool({
    name: "zhixue_sync_status",
    label: "查看智学网同步状态",
    description: "读取登录桥接状态。学情同步数据桥接接入前，不会伪装成同步完成。",
    promptSnippet: "zhixue_sync_status: 读取登录桥接状态",
    parameters: Type.Object({}),
    executionMode: "sequential" as const,
    execute: async () => {
      const state = current(paths);
      if (state?.status !== "authenticated") {
        return textResult(statusText(state), statusDetails(paths, state), loginFailed(state)
          ? { isError: true, terminate: true }
          : {});
      }
      const configValue = readJson(paths.config);
      const config = validSyncConfig(configValue) ? configValue : null;
      const syncState = syncForLogin(paths, state.flowId);
      return textResult(syncText(syncState, config), {
        ...statusDetails(paths, state, syncPhase(syncState, config !== null)),
        sync: syncState,
        config: config ?? undefined,
      }, syncState?.status === "failed" || syncState?.status === "needs_login"
        ? { isError: true, terminate: true } : {});
    },
  });
  const sync = defineTool({
    name: "zhixue_sync",
    label: "同步智学网学情",
    description: "按老师提供的班级、学科和学段配置同步智学网基础学情。同步在隔离浏览器进程中执行，结果写入当前用户数据根，并明确报告成功、空结果、登录失效或失败。",
    promptSnippet: "zhixue_sync: 登录确认后，按已确认的班级、学科、学段开始同步",
    parameters: Type.Object({
      month: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}$" })),
      className: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      subjectCode: Type.Optional(Type.String({ pattern: "^\\d+$", maxLength: 12 })),
      phaseCode: Type.Optional(Type.String({ pattern: "^\\d+$", maxLength: 12 })),
      gradeCode: Type.Optional(Type.String({ pattern: "^\\d+$", maxLength: 12 })),
      schoolId: Type.Optional(Type.String({ maxLength: 160 })),
      classId: Type.Optional(Type.String({ maxLength: 160 })),
    }),
    executionMode: "sequential" as const,
    execute: async (_callId, params) => {
      if (params.month !== undefined && !validMonth(params.month)) {
        return textResult("同步月份必须是有效的 YYYY-MM，例如 2026-11。", undefined, { isError: true, terminate: true });
      }
      const loginState = current(paths);
      if (loginState?.status !== "authenticated") {
        return textResult(statusText(loginState), statusDetails(paths, loginState), { isError: true, terminate: true });
      }
      if (syncBusy(paths) || browserBusy(paths)) {
        const existing = syncForLogin(paths, loginState.flowId);
        const running = existing?.status === "running" ? existing : null;
        return textResult(running?.message || "智学网窗口正在使用，请稍后再试。",
          { ...statusDetails(paths, loginState, running ? "running" : "busy"), sync: running }, { terminate: true });
      }
      const previous = readJson<SyncConfig>(paths.config);
      const next: SyncConfig = {
        className: params.className?.trim() || previous?.className || "",
        subjectCode: params.subjectCode || previous?.subjectCode || "",
        phaseCode: params.phaseCode || previous?.phaseCode || "",
        ...(params.gradeCode || previous?.gradeCode ? { gradeCode: params.gradeCode || previous?.gradeCode } : {}),
        ...(params.schoolId || previous?.schoolId ? { schoolId: params.schoolId || previous?.schoolId } : {}),
        ...(params.classId || previous?.classId ? { classId: params.classId || previous?.classId } : {}),
      };
      if (!validSyncConfig(next)) {
        return textResult("同步前需要明确提供班级、学科代码和学段代码。没有这些信息不会启动抓取。",
          { ...statusDetails(paths, loginState, "needs_config"), config: next }, { isError: true, terminate: true });
      }
      atomicJson(paths.config, next);
      const syncFlowId = randomUUID();
      atomicJson(paths.syncState, {
        version: 1,
        flowId: syncFlowId,
        status: "running",
        loginFlowId: loginState.flowId,
        month: params.month || new Date().toISOString().slice(0, 7),
        config: next,
        message: `正在同步 ${next.className} 的学情数据。`,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies SyncState);
      if (!claimLock(paths.browserLock, { version: 1, flowId: syncFlowId, pid: 0, startedAt: new Date().toISOString() })) {
        writeSyncFailure(paths, syncFlowId, "浏览器登录会话已被另一个任务占用。");
        return textResult("智学网窗口正在使用，请稍后再试。", statusDetails(paths, loginState, "busy"), { isError: true, terminate: true });
      }
      const child = spawn(process.execPath, [
        syncWorkerPath,
        "--root", paths.root,
        "--flow-id", syncFlowId,
        "--login-flow-id", loginState.flowId,
        "--state", paths.syncState,
        "--session", paths.session,
        "--profile", paths.profile,
        "--config", paths.config,
        "--snapshot", paths.syncSnapshot,
        "--month", params.month || new Date().toISOString().slice(0, 7),
        "--lock", paths.syncLock,
        "--browser-lock", paths.browserLock,
      ], { cwd: paths.root, detached: true, stdio: "ignore", env: { ...process.env } });
      if (!child.pid) {
        child.once("error", () => {});
        atomicJson(paths.syncState, {
          version: 1,
          flowId: syncFlowId,
          loginFlowId: loginState.flowId,
          status: "failed",
          month: params.month || new Date().toISOString().slice(0, 7),
          config: next,
          error: "同步进程启动失败。",
          updatedAt: new Date().toISOString(),
        } satisfies SyncState);
        releaseLockForFlow(paths.syncLock, syncFlowId);
        releaseLockForFlow(paths.browserLock, syncFlowId);
        return textResult("同步进程启动失败。", statusDetails(paths, loginState, "failed"), { isError: true, terminate: true });
      }
      child.once("error", () => {
        writeSyncFailure(paths, syncFlowId, "同步进程启动失败。");
        releaseLockForFlow(paths.syncLock, syncFlowId);
        releaseLockForFlow(paths.browserLock, syncFlowId);
      });
      child.once("exit", () => {
        releaseLockForFlow(paths.syncLock, syncFlowId);
        releaseLockForFlow(paths.browserLock, syncFlowId);
        writeSyncFailure(paths, syncFlowId, "同步进程异常退出，请重试。");
      });
      child.unref();
      return textResult(`已开始同步 ${next.className} 的学情数据。完成后查看同步状态。`, {
        ...statusDetails(paths, loginState, "running"),
        flowId: syncFlowId,
        config: next,
        pid: child.pid,
      }, { terminate: true });
    },
  });
  return [login, status, syncStatus, sync];
}
