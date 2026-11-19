import { randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";

type LoginState = {
  version: 1;
  flowId: string;
  status: "starting" | "awaiting_scan" | "authenticated" | "expired" | "error";
  pid?: number;
  qrPath?: string;
  authenticatedAt?: string;
  updatedAt?: string;
  error?: string;
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
  };
}

function current(layoutValue: ReturnType<typeof layout>): LoginState | null {
  const state = readJson<LoginState>(layoutValue.state);
  if (!state || state.status !== "authenticated") return state;
  const session = readJson<{ flowId?: string }>(layoutValue.session);
  const loginOk = readJson<{ flowId?: string }>(layoutValue.loginOk);
  if (session?.flowId === state.flowId && loginOk?.flowId === state.flowId) return state;
  return {
    ...state,
    status: "error",
    error: "登录回执与当前登录 flow 不一致，请重新扫码。",
  };
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
  if (!state?.qrPath || state.qrPath !== layoutValue.qr) return undefined;
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

function releaseLockForFlow(path: string, flowId: string): void {
  const lock = readJson<{ flowId?: string }>(path);
  if (lock?.flowId === flowId) {
    try { unlinkSync(path); } catch {}
  }
}

function statusText(state: LoginState | null): string {
  if (!state) return "还没有发起智学网登录。";
  if (state.status === "awaiting_scan") return "二维码已显示，请用智学网教师端 APP 扫码。扫码完成后再检查一次登录状态。";
  if (state.status === "starting") return "登录窗口正在启动，请稍等。";
  if (state.status === "authenticated") return `智学网登录已完成（${state.authenticatedAt ?? "时间未知"}）。`;
  if (state.status === "expired") return "扫码等待已超时，请重新发起登录。";
  return `智学网登录失败：${state.error ?? "未知错误"}。`;
}

export function createEduPiZhixueTools(projectRoot: string, workerPath: string) {
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
      if (busy(paths) || !claimLock(paths.lock, { version: 1, flowId, startedAt: new Date().toISOString(), pid: 0 })) {
        return textResult("智学网登录窗口已经在运行，请完成当前扫码，不要再次弹窗。", visual(paths, current(paths)), { terminate: true });
      }
      atomicJson(paths.state, { version: 1, flowId, status: "starting", startedAt: new Date().toISOString() });
      const child = spawn(process.execPath, [
        workerPath, "--root", paths.root, "--flow-id", flowId, "--state", paths.state,
        "--session", paths.session, "--qr", paths.qr, "--profile", paths.profile,
      ], { cwd: paths.root, detached: true, stdio: "ignore", env: { ...process.env } });
      if (!child.pid) {
        try { unlinkSync(paths.lock); } catch {}
        return textResult("智学网登录进程启动失败。", undefined, { isError: true, terminate: true });
      }
      let childExited = false;
      child.once("exit", () => {
        childExited = true;
        releaseLockForFlow(paths.lock, flowId);
      });
      atomicJson(paths.lock, { version: 1, flowId, startedAt: new Date().toISOString(), pid: child.pid });
      if (childExited) releaseLockForFlow(paths.lock, flowId);
      child.unref();
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const state = current(paths);
        if (state?.flowId === flowId && (state.status === "awaiting_scan" || state.status === "authenticated" || state.status === "error")) {
          return textResult(statusText(state), visual(paths, state), { terminate: true });
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      }
      const state = current(paths);
      return textResult("登录窗口已启动，请等待二维码出现；本条请求不会再次弹窗。", visual(paths, state), { terminate: true });
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
      return textResult(statusText(state), visual(paths, state), { terminate: true });
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
      return textResult(state?.status === "authenticated"
        ? "登录态已确认，但学情数据同步桥接尚未接入。"
        : statusText(state), visual(paths, state), state?.status === "authenticated" ? { isError: true, terminate: true } : { terminate: true });
    },
  });
  const sync = defineTool({
    name: "zhixue_sync",
    label: "同步智学网学情",
    description: "当前版本只负责登录回调和登录态确认，学情数据同步仍需单独接入。",
    promptSnippet: "zhixue_sync: 当前仅返回同步桥接未接入状态",
    parameters: Type.Object({ month: Type.Optional(Type.String()) }),
    executionMode: "sequential" as const,
    execute: async () => textResult("智学网登录桥已接通，但学情数据同步还未接入 Desktop，暂不执行抓取。", undefined, { isError: true, terminate: true }),
  });
  return [login, status, syncStatus, sync];
}
