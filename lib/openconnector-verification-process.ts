import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readDesktopSystemProxy, type DesktopSystemProxy } from "./desktop-system-proxy";
import {
  GITHUB_VERIFICATION_ACTION, isGitHubVerificationConnection, isGitHubVerificationReceipt,
  parseGitHubVerificationOperation, type GitHubVerificationConnection, type GitHubVerificationOperation,
  type GitHubVerificationReceipt, type GitHubVerificationStatus,
} from "./openconnector-verification-contract";

const executeFile = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;
const HOST_FILE = "verification-host.mjs";
type Account = Pick<GitHubVerificationConnection, "accountId" | "login" | "htmlUrl">;
type HostRequest = { id: string; credential: string; network?: DesktopSystemProxy } & ({ op: "connect" } | { op: "verify"; expectedAccountId: string; requestId: string });
type HostResult = { id: string; ok: false; code: string } | { id: string; ok: true; data: { account?: Account; status?: string; executionId?: string; auditPersisted?: boolean; profile?: unknown; code?: string } };
type PrivateConnection = GitHubVerificationConnection & { credentialFingerprint: string };
type StoredState = { version: 1; connection: PrivateConnection | null; latestReceiptId: string | null };
type StoredReceipt = GitHubVerificationReceipt & { ownerProcessId?: number };

/** Overrides are for hermetic tests; no request body can select executables or credentials. */
export type GitHubVerificationOptions = {
  stateDir?: string;
  root?: string;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  ghExecutable?: string;
  timeoutMs?: number;
  getCredential?: () => Promise<string>;
  runHost?: (request: HostRequest) => Promise<HostResult>;
  readSystemProxy?: () => Promise<DesktopSystemProxy | undefined>;
  proxyEnv?: NodeJS.ProcessEnv;
};

export class GitHubVerificationError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "GitHubVerificationError"; }
}

declare global {
  var __edupiGitHubVerificationActive: Set<string> | undefined;
}

const active = globalThis.__edupiGitHubVerificationActive ??= new Set<string>();

function fail(code = "github_verification_unavailable"): never { throw new GitHubVerificationError(code); }

async function resolveDirectory(options: GitHubVerificationOptions): Promise<string | null> {
  const stateDir = options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR;
  const root = options.root ?? process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  if ((options.platform ?? process.platform) !== "darwin" || !stateDir || !root || !path.isAbsolute(stateDir) || !path.isAbsolute(root)) return null;
  try {
    if (!(await lstat(root)).isDirectory() || !(await lstat(path.join(root, HOST_FILE))).isFile()) return null;
  } catch { return null; }
  const dir = path.join(stateDir, "openconnector-read-verification");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stats = await lstat(dir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail();
  await chmod(dir, 0o700);
  await mkdir(path.join(dir, "receipts"), { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const receiptDir = await lstat(path.join(dir, "receipts"));
  if (!receiptDir.isDirectory() || receiptDir.isSymbolicLink()) fail();
  await chmod(path.join(dir, "receipts"), 0o700);
  return dir;
}

async function readPrivateJson(file: string): Promise<unknown | null> {
  try {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 16 * 1024) fail();
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail();
  }
}

async function loadState(dir: string): Promise<StoredState> {
  const value = await readPrivateJson(path.join(dir, "state.json")) as StoredState | null;
  if (value === null) return { version: 1, connection: null, latestReceiptId: null };
  if (value.version !== 1 || value.connection !== null && (!isGitHubVerificationConnection(value.connection)
    || typeof value.connection.credentialFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.connection.credentialFingerprint))
    || value.latestReceiptId !== null && (typeof value.latestReceiptId !== "string" || !UUID.test(value.latestReceiptId))) fail();
  return value;
}

function receiptFile(dir: string, id: string): string {
  if (!UUID.test(id)) fail("invalid_verification_request");
  return path.join(dir, "receipts", `${id}.json`);
}

async function loadReceipt(dir: string, id: string | null): Promise<StoredReceipt | null> {
  if (!id) return null;
  const value = await readPrivateJson(receiptFile(dir, id));
  if (value === null) return null;
  if (!isGitHubVerificationReceipt(value)) fail();
  return value;
}

function saveState(dir: string, state: StoredState): void {
  writePrivateFileAtomicSync(path.join(dir, "state.json"), JSON.stringify(state) + "\n");
}

function saveReceipt(dir: string, receipt: StoredReceipt): void {
  writePrivateFileAtomicSync(receiptFile(dir, receipt.id), JSON.stringify(receipt) + "\n");
}

function projectConnection(value: PrivateConnection | null): GitHubVerificationConnection | null {
  if (!value) return null;
  const { id, service, accountId, login, htmlUrl, authorizedAt } = value;
  return { id, service, accountId, login, htmlUrl, authorizedAt };
}

function projectReceipt(value: StoredReceipt | null): GitHubVerificationReceipt | null {
  if (!value) return null;
  const { id, connectionId, actionId, login, status, startedAt, completedAt, executionId, auditPersisted, profile, code } = value;
  return { id, connectionId, actionId, login, status, startedAt, auditPersisted,
    ...(completedAt ? { completedAt } : {}), ...(executionId ? { executionId } : {}),
    ...(profile ? { profile: { login: profile.login, id: profile.id, htmlUrl: profile.htmlUrl, publicRepos: profile.publicRepos } } : {}), ...(code ? { code } : {}) };
}

async function statusFromState(dir: string, state: StoredState, receiptOverride?: StoredReceipt | null): Promise<GitHubVerificationStatus> {
  return { supported: true, connection: projectConnection(state.connection), receipt: projectReceipt(receiptOverride === undefined ? await loadReceipt(dir, state.latestReceiptId) : receiptOverride) };
}

async function withOperationLock<T>(dir: string, operation: () => Promise<T>): Promise<T> {
  if (active.has(dir)) fail("github_verification_busy");
  let release;
  let compromised = false;
  try {
    release = await lockfile.lock(dir, { retries: 0, stale: 45_000, update: 10_000, onCompromised: () => { compromised = true; } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") fail("github_verification_busy");
    fail();
  }
  active.add(dir);
  try {
    const result = await operation();
    if (compromised) fail();
    return result;
  } finally {
    active.delete(dir);
    await release().catch(() => {});
  }
}

async function recoverPending(dir: string, state: StoredState): Promise<void> {
  const receipt = await loadReceipt(dir, state.latestReceiptId);
  if (receipt?.status === "pending") {
    saveReceipt(dir, { ...receipt, status: "unknown", completedAt: new Date().toISOString(), code: "github_execution_interrupted", auditPersisted: false });
  }
}

export async function readGitHubVerificationStatus(options: GitHubVerificationOptions = {}): Promise<GitHubVerificationStatus> {
  const dir = await resolveDirectory(options);
  if (!dir) return { supported: false, connection: null, receipt: null };
  try {
    return await withOperationLock(dir, async () => {
      const state = await loadState(dir);
      await recoverPending(dir, state);
      return statusFromState(dir, state);
    });
  } catch (error) {
    if (error instanceof GitHubVerificationError && error.code === "github_verification_busy") return statusFromState(dir, await loadState(dir));
    throw error;
  }
}

async function readGitHubCredential(options: GitHubVerificationOptions): Promise<string> {
  if (options.getCredential) {
    const credential = await options.getCredential();
    if (typeof credential !== "string" || credential.length < 16 || credential.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(credential)) fail("github_login_required");
    return credential;
  }
  const candidates = options.ghExecutable ? [options.ghExecutable] : ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", ...String(process.env.PATH ?? "").split(path.delimiter).filter(path.isAbsolute).map((item) => path.join(item, "gh"))];
  let executable;
  for (const item of candidates) {
    if (!path.isAbsolute(item)) continue;
    try { await access(item, constants.X_OK); executable = item; break; } catch { /* Try a standard installed CLI path. */ }
  }
  if (!executable) fail("github_login_required");
  try {
    const { stdout } = await executeFile(executable, ["auth", "token", "--hostname", "github.com"], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 8192,
      env: { NODE_ENV: "production", HOME: homedir(), PATH: process.env.PATH ?? "", GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    const credential = stdout.trim();
    if (credential.length < 16 || credential.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(credential)) fail("github_login_required");
    return credential;
  } catch { fail("github_login_required"); }
}

async function runVerificationHost(request: HostRequest, options: GitHubVerificationOptions): Promise<HostResult> {
  if (options.runHost) return options.runHost(request);
  const root = options.root ?? process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  const node = options.nodeExecutable ?? process.execPath;
  if (!root || !path.isAbsolute(root) || !path.isAbsolute(node)) fail();
  const dataDir = await mkdtemp(path.join(tmpdir(), "edupi-openconnector-verification-"));
  await chmod(dataDir, 0o700);
  const child = spawn(node, [path.join(root, HOST_FILE), dataDir], {
    cwd: root, env: { NODE_ENV: "production", PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.on("error", () => {});
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closedPromise = new Promise<void>((resolveClose) => child.once("close", () => { closed = true; resolveClose(); }));
  try {
    const output = await new Promise<string>((resolveOutput, rejectOutput) => {
      const parts: Buffer[] = [];
      let bytes = 0;
      child.once("error", () => rejectOutput(new GitHubVerificationError("github_verification_unavailable")));
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 16 * 1024) { child.kill("SIGKILL"); rejectOutput(new GitHubVerificationError("github_verification_unavailable")); }
        else parts.push(chunk);
      });
      child.once("close", (code) => code === 0 ? resolveOutput(Buffer.concat(parts).toString("utf8")) : rejectOutput(new GitHubVerificationError("github_verification_unavailable")));
      timer = setTimeout(() => { child.kill("SIGKILL"); rejectOutput(new GitHubVerificationError("github_verification_timeout")); }, options.timeoutMs ?? 35_000);
      child.stdin.end(JSON.stringify(request));
    });
    if (output.includes(request.credential)) fail();
    let result;
    try { result = JSON.parse(output) as HostResult; } catch { fail(); }
    if (!result || typeof result !== "object" || result.id !== request.id || typeof result.ok !== "boolean") fail();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (!closed) {
      child.kill("SIGKILL");
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([closedPromise, new Promise<void>((resolveDone) => { cleanupTimer = setTimeout(resolveDone, 1000); })]);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}

function credentialFingerprint(credential: string): string {
  return `sha256:${createHash("sha256").update(credential).digest("hex")}`;
}

async function verificationNetwork(options: GitHubVerificationOptions): Promise<DesktopSystemProxy | undefined> {
  const env = options.proxyEnv ?? process.env;
  const http = env.http_proxy || env.HTTP_PROXY;
  const https = env.https_proxy || env.HTTPS_PROXY;
  if (!http && !https) return options.readSystemProxy ? options.readSystemProxy() : readDesktopSystemProxy({ env });
  const proxy = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      const port = Number(url.port || "80");
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        || !Number.isInteger(port) || port < 1 || port > 65_535 || url.username || url.password
        || url.pathname !== "/" || url.search || url.hash || value.length > 256) fail("github_proxy_unsupported");
      return url.origin;
    } catch { fail("github_proxy_unsupported"); }
  };
  const noProxy = ["localhost,127.0.0.1,::1,[::1]", env.no_proxy || env.NO_PROXY].filter(Boolean).join(",");
  if (noProxy.length > 2048 || /[\u0000-\u001f\u007f]/u.test(noProxy)) fail("github_proxy_unsupported");
  return { httpProxy: proxy(http), httpsProxy: proxy(https), noProxy };
}

function allowedHostCode(code: unknown): string {
  return typeof code === "string" && ["github_authorization_failed", "github_connection_unavailable", "github_account_changed", "github_execution_unknown", "github_audit_unavailable", "github_execution_failed", "github_result_mismatch"].includes(code)
    ? code : "github_verification_unavailable";
}

export async function runGitHubVerificationOperation(input: GitHubVerificationOperation, options: GitHubVerificationOptions = {}): Promise<GitHubVerificationStatus> {
  const operation = parseGitHubVerificationOperation(input);
  if (!operation) fail("invalid_verification_request");
  const dir = await resolveDirectory(options);
  if (!dir) fail("github_verification_unsupported");
  return withOperationLock(dir, async () => {
    const state = await loadState(dir);
    await recoverPending(dir, state);
    if (operation.op === "disconnect") {
      if (state.connection?.id !== operation.connectionId) fail("github_connection_changed");
      state.connection = null;
      saveState(dir, state);
      return statusFromState(dir, state);
    }
    if (operation.op === "verify") {
      const previous = await loadReceipt(dir, operation.requestId);
      if (previous) {
        if (previous.connectionId !== operation.connectionId) fail("github_request_conflict");
        if (previous.status === "pending") {
          previous.status = "unknown";
          previous.completedAt = new Date().toISOString();
          previous.code = "github_execution_interrupted";
          saveReceipt(dir, previous);
        }
        return statusFromState(dir, state, previous);
      }
      if (state.connection?.id !== operation.connectionId) fail("github_connection_changed");
    }
    const network = await verificationNetwork(options);
    const credential = await readGitHubCredential(options);
    const fingerprint = credentialFingerprint(credential);
    if (operation.op === "connect") {
      const result = await runVerificationHost({ id: randomUUID(), op: "connect", credential, ...(network ? { network } : {}) }, options);
      if (!result.ok) fail(allowedHostCode(result.code));
      const account = result.data?.account;
      if (!account || typeof account.login !== "string" || !LOGIN.test(account.login)
        || account.accountId !== account.login.toLowerCase() || account.htmlUrl !== `https://github.com/${account.login}`) fail();
      state.connection = { id: randomUUID(), service: "github", accountId: account.accountId, login: account.login, htmlUrl: account.htmlUrl,
        authorizedAt: new Date().toISOString(), credentialFingerprint: fingerprint };
      saveState(dir, state);
      return statusFromState(dir, state);
    }
    const connection = state.connection!;
    if (connection.credentialFingerprint !== fingerprint) fail("github_connection_changed");
    const receipt: StoredReceipt = {
      id: operation.requestId, connectionId: connection.id, actionId: GITHUB_VERIFICATION_ACTION, login: connection.login,
      status: "pending", startedAt: new Date().toISOString(), auditPersisted: false, ownerProcessId: process.pid,
    };
    saveReceipt(dir, receipt);
    state.latestReceiptId = receipt.id;
    saveState(dir, state);
    try {
      const result = await runVerificationHost({ id: randomUUID(), op: "verify", credential, expectedAccountId: connection.accountId, requestId: operation.requestId, ...(network ? { network } : {}) }, options);
      if (!result.ok) {
        receipt.status = "failed";
        receipt.code = allowedHostCode(result.code);
      } else {
        const data = result.data;
        if (!["succeeded", "failed", "unknown"].includes(data.status ?? "")) fail();
        receipt.status = data.status as "succeeded" | "failed" | "unknown";
        receipt.auditPersisted = data.auditPersisted === true;
        if (typeof data.executionId === "string" && UUID.test(data.executionId)) receipt.executionId = data.executionId;
        if (data.code) receipt.code = allowedHostCode(data.code);
        if (data.profile && typeof data.profile === "object" && !Array.isArray(data.profile)) {
          const profile = data.profile as Record<string, unknown>;
          receipt.profile = { login: profile.login as string, id: profile.id as number, htmlUrl: profile.htmlUrl as string, publicRepos: profile.publicRepos as number };
        }
      }
      receipt.completedAt = new Date().toISOString();
      if (!isGitHubVerificationReceipt(receipt)) fail();
    } catch {
      receipt.status = "unknown";
      receipt.code = "github_execution_unknown";
      receipt.auditPersisted = false;
      receipt.completedAt = new Date().toISOString();
      delete receipt.profile;
    }
    saveReceipt(dir, receipt);
    return statusFromState(dir, state, receipt);
  });
}
