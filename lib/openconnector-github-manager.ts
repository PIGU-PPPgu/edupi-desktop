import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { loadOrCreateGitHubRuntimeKey } from "./desktop-keychain";
import { readDesktopSystemProxy, type DesktopSystemProxy } from "./desktop-system-proxy";
import {
  isGitHubCallbackUrl, isGitHubOAuthConnection, isGitHubOAuthRequest, isGitHubOAuthStatus,
  isGitHubTestIssueDraft, isGitHubTestIssueReceipt, makeTestIssueInput, parseGitHubOAuthOperation,
  type GitHubOAuthConnection, type GitHubOAuthOperation, type GitHubOAuthStatus, type GitHubTestIssueReceipt,
} from "./openconnector-github-contract";

export type GitHubHostClient = { request: (operation: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void>; callbackUrl: string };
export type GitHubManagerOptions = {
  stateDir?: string;
  root?: string;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  timeoutMs?: number;
  getEncryptionKey?: (databaseExists: boolean) => Promise<string>;
  hostFactory?: (runtimeDir: string, key: string, network?: DesktopSystemProxy) => Promise<GitHubHostClient>;
  readSystemProxy?: () => Promise<DesktopSystemProxy | undefined>;
  proxyEnv?: NodeJS.ProcessEnv;
};
type SavedState = Omit<GitHubOAuthStatus, "supported" | "callbackUrl"> & { version: 1 };
type HostEntry = { client: GitHubHostClient; root: string };

export class GitHubManagerError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "GitHubManagerError"; }
}
function fail(code = "github_oauth_unavailable"): never { throw new GitHubManagerError(code); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function inputHash(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

declare global {
  var __edupiGitHubOAuthHosts: Map<string, Promise<HostEntry>> | undefined;
  var __edupiGitHubOAuthActive: Set<string> | undefined;
}
const hosts = globalThis.__edupiGitHubOAuthHosts ??= new Map<string, Promise<HostEntry>>();
const active = globalThis.__edupiGitHubOAuthActive ??= new Set<string>();

const empty = (): SavedState => ({ version: 1, clientConfigured: false, clientId: null, authorization: null, connection: null, draft: null, receipt: null });
function project(state: SavedState, callbackUrl: string | null): GitHubOAuthStatus {
  return { supported: true, clientConfigured: state.clientConfigured, clientId: state.clientId, callbackUrl,
    authorization: state.authorization, connection: state.connection, draft: state.draft, receipt: state.receipt };
}
async function resolveDirectory(options: GitHubManagerOptions): Promise<string | null> {
  const parent = options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR;
  const root = options.root ?? process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  if ((options.platform ?? process.platform) !== "darwin" || !parent || !root || !path.isAbsolute(parent) || !path.isAbsolute(root)) return null;
  try { if (!(await lstat(root)).isDirectory() || !(await lstat(path.join(root, "github-host.mjs"))).isFile()) return null; } catch { return null; }
  const dir = path.join(parent, "openconnector-github");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink()) fail();
  await chmod(dir, 0o700);
  const runtime = path.join(dir, "runtime");
  await mkdir(runtime, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const stat = await lstat(runtime);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  await chmod(runtime, 0o700);
  return dir;
}
async function loadState(dir: string): Promise<SavedState> {
  let value: unknown;
  try {
    const file = path.join(dir, "state.json"), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024) fail();
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw error instanceof GitHubManagerError ? error : new GitHubManagerError("github_oauth_unavailable"); }
  if (!record(value) || value.version !== 1 || !isGitHubOAuthStatus({ ...value, supported: true, callbackUrl: null })
    || value.draft && (!isGitHubTestIssueDraft(value.draft) || value.draft.inputHash !== inputHash(value.draft.input))) fail("github_state_invalid");
  const status = value as unknown as SavedState;
  return { version: 1, clientConfigured: status.clientConfigured, clientId: status.clientId, authorization: status.authorization,
    connection: status.connection, draft: status.draft, receipt: status.receipt };
}
function saveState(dir: string, state: SavedState): void { writePrivateFileAtomicSync(path.join(dir, "state.json"), JSON.stringify(state) + "\n"); }
function recoverPending(dir: string, state: SavedState): void {
  if (state.receipt?.status === "pending") {
    state.receipt = { ...state.receipt, status: "unknown", completedAt: new Date().toISOString(), code: "github_write_interrupted", auditPersisted: false, readbackVerified: false };
    saveState(dir, state);
  }
}
async function withLock<T>(dir: string, operation: () => Promise<T>): Promise<T> {
  if (active.has(dir)) fail("github_oauth_busy");
  let release;
  let compromised = false;
  try { release = await lockfile.lock(dir, { retries: 0, stale: 60_000, update: 10_000, onCompromised: () => { compromised = true; } }); }
  catch (error) { fail((error as NodeJS.ErrnoException).code === "ELOCKED" ? "github_oauth_busy" : "github_oauth_unavailable"); }
  active.add(dir);
  try { const result = await operation(); if (compromised) fail(); return result; }
  finally { active.delete(dir); await release().catch(() => {}); }
}

function localProxy(value: string): string | null {
  try {
    const u = new URL(value), port = Number(u.port || "80");
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && Number.isInteger(port) && port > 0 && port <= 65535
      && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash ? u.origin : null;
  } catch { return null; }
}
async function networkOptions(options: GitHubManagerOptions): Promise<DesktopSystemProxy | undefined> {
  const env = options.proxyEnv ?? process.env;
  const http = env.http_proxy || env.HTTP_PROXY, https = env.https_proxy || env.HTTPS_PROXY;
  if (http || https) {
    const httpProxy = http ? localProxy(http) : undefined, httpsProxy = https ? localProxy(https) : undefined;
    if (http && !httpProxy || https && !httpsProxy) fail("github_proxy_unsupported");
    return { ...(httpProxy ? { httpProxy } : {}), ...(httpsProxy ? { httpsProxy } : {}), noProxy: "localhost,127.0.0.1,::1,[::1]" };
  }
  return options.readSystemProxy ? options.readSystemProxy() : readDesktopSystemProxy();
}

async function spawnHost(dir: string, options: GitHubManagerOptions, onTerminate: () => void): Promise<HostEntry> {
  const root = options.root ?? process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  if (!root) fail();
  const runtimeDir = path.join(dir, "runtime");
  let databaseExists = false;
  try {
    const database = await lstat(path.join(runtimeDir, "connect.sqlite"));
    if (!database.isFile() || database.isSymbolicLink()) fail("github_state_invalid");
    databaseExists = true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const network = await networkOptions(options);
  let key: string;
  try { key = await (options.getEncryptionKey ?? ((exists: boolean) => loadOrCreateGitHubRuntimeKey({ databaseExists: exists })))(databaseExists); }
  catch { fail("github_keychain_unavailable"); }
  if (!/^[a-f0-9]{64}$/u.test(key)) fail("github_keychain_unavailable");
  if (options.hostFactory) return { client: await options.hostFactory(runtimeDir, key, network), root };
  const node = options.nodeExecutable ?? process.execPath;
  if (!path.isAbsolute(node)) fail();
  const child = spawn(node, [path.join(root, "github-host.mjs"), runtimeDir], {
    cwd: root, env: { NODE_ENV: "production", PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.on("error", () => {});
  let buffer = Buffer.alloc(0), closed = false;
  const closedPromise = new Promise<void>((resolveClosed) => child.once("close", () => resolveClosed()));
  const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const terminate = () => {
    if (!closed) child.kill("SIGKILL");
    closed = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new GitHubManagerError("github_host_unavailable")); }
    pending.clear();
    onTerminate();
  };
  child.once("error", terminate);
  child.once("close", terminate);
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 64 * 1024) { terminate(); return; }
    let newline = buffer.indexOf(10);
    while (newline >= 0) {
      let response: unknown;
      try { response = JSON.parse(buffer.subarray(0, newline).toString("utf8")); } catch { terminate(); return; }
      buffer = buffer.subarray(newline + 1);
      if (!record(response) || typeof response.id !== "string" || !pending.has(response.id) || typeof response.ok !== "boolean") { terminate(); return; }
      const item = pending.get(response.id)!;
      pending.delete(response.id); clearTimeout(item.timer);
      if (response.ok) item.resolve(response.data);
      else item.reject(new GitHubManagerError(typeof response.code === "string" && /^github_[a-z_]{1,70}$/u.test(response.code) ? response.code : "github_host_unavailable"));
      newline = buffer.indexOf(10);
    }
  });
  const request = (operation: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    if (closed) { reject(new GitHubManagerError("github_host_unavailable")); return; }
    const id = randomUUID();
    const timer = setTimeout(() => { terminate(); reject(new GitHubManagerError("github_host_timeout")); }, options.timeoutMs ?? 45_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, ...operation }) + "\n");
  });
  const init = await request({ op: "init", encryptionKey: key, ...(network ? { network } : {}) });
  key = "";
  if (!record(init) || init.ready !== true || !isGitHubCallbackUrl(init.callbackUrl)) { terminate(); fail(); }
  const client: GitHubHostClient = { callbackUrl: init.callbackUrl, request, close: async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    try { await closedPromise; } finally { clearTimeout(timer); }
  } };
  return { client, root };
}

async function hostFor(dir: string, options: GitHubManagerOptions): Promise<GitHubHostClient> {
  let entry = hosts.get(dir);
  if (!entry) {
    const owned = spawnHost(dir, options, () => { if (hosts.get(dir) === owned) hosts.delete(dir); });
    entry = owned;
    hosts.set(dir, entry);
    entry.catch(() => { if (hosts.get(dir) === entry) hosts.delete(dir); });
  }
  return (await entry).client;
}
export async function closeGitHubOAuthHost(stateDir: string): Promise<void> {
  const dir = path.join(stateDir, "openconnector-github"), entry = hosts.get(dir);
  hosts.delete(dir);
  if (entry) await (await entry).client.close();
}

async function refreshConnection(client: GitHubHostClient, state: SavedState): Promise<GitHubOAuthConnection | null> {
  const data = await client.request({ op: "status", ...(state.connection ? { connectionId: state.connection.id } : {}) });
  if (!record(data) || typeof data.clientConfigured !== "boolean") fail();
  state.clientConfigured = data.clientConfigured;
  if (data.connection === null || data.connection === undefined) return null;
  if (!isGitHubOAuthConnection(data.connection)) fail("github_connection_changed");
  return data.connection;
}

export async function readGitHubOAuthStatus(options: GitHubManagerOptions = {}): Promise<GitHubOAuthStatus> {
  const dir = await resolveDirectory(options);
  if (!dir) return { ...project(empty(), null), supported: false };
  try {
    return await withLock(dir, async () => {
      const state = await loadState(dir);
      recoverPending(dir, state);
      const client = await hostFor(dir, options);
      if (state.connection) {
        const actual = await refreshConnection(client, state);
        if (!actual || actual.id !== state.connection.id || actual.accountId !== state.connection.accountId) state.connection = null;
      }
      saveState(dir, state);
      return project(state, client.callbackUrl);
    });
  } catch (error) {
    if (error instanceof GitHubManagerError && error.code === "github_oauth_busy") return project(await loadState(dir), null);
    throw error;
  }
}

function applyReceiptData(receipt: GitHubTestIssueReceipt, data: unknown): GitHubTestIssueReceipt {
  if (!record(data) || !["succeeded", "failed", "unknown"].includes(data.status as string)) fail();
  const next = { ...receipt, status: data.status, completedAt: new Date().toISOString(),
    auditPersisted: data.auditPersisted === true, readbackVerified: data.readbackVerified === true,
    ...(data.issue ? { issue: data.issue } : {}), ...(data.writeExecutionId ? { writeExecutionId: data.writeExecutionId } : {}),
    ...(data.readExecutionId ? { readExecutionId: data.readExecutionId } : {}),
    ...(typeof data.code === "string" && /^github_[a-z_]{1,70}$/u.test(data.code) ? { code: data.code } : {}) };
  if (data.code === undefined) delete next.code;
  if (!isGitHubTestIssueReceipt(next)) fail();
  return next;
}

export async function runGitHubOAuthOperation(input: GitHubOAuthOperation, options: GitHubManagerOptions = {}): Promise<GitHubOAuthStatus> {
  const operation = parseGitHubOAuthOperation(input);
  if (!operation) fail("invalid_github_request");
  const dir = await resolveDirectory(options);
  if (!dir) fail("github_oauth_unsupported");
  return withLock(dir, async () => {
    const state = await loadState(dir);
    recoverPending(dir, state);
    if (operation.op === "createTestIssue" && state.receipt) {
      if (state.receipt.draftId !== operation.draftId) fail("github_request_conflict");
      return project(state, null);
    }
    const client = await hostFor(dir, options);
    if (operation.op === "configureOAuth") {
      if (state.receipt) fail("github_write_already_started");
      const result = await client.request({ op: "configure", clientId: operation.clientId, clientSecret: operation.clientSecret });
      if (!record(result) || result.clientConfigured !== true) fail();
      state.clientConfigured = true; state.clientId = operation.clientId; state.authorization = null; state.connection = null; state.draft = null;
    } else if (operation.op === "startOAuth") {
      if (!state.clientConfigured || state.receipt) fail(state.receipt ? "github_write_already_started" : "github_client_required");
      const result = await client.request({ op: "startOAuth" });
      if (!record(result) || !isGitHubOAuthRequest({ ...result, status: "pending" })) fail();
      state.authorization = { requestId: result.requestId as string, authorizationUrl: result.authorizationUrl as string, expiresAt: result.expiresAt as string, status: "pending" };
      state.connection = null; state.draft = null;
    } else if (operation.op === "pollOAuth" || operation.op === "cancelOAuth") {
      if (state.authorization?.requestId !== operation.requestId) fail("github_authorization_changed");
      if (operation.op === "cancelOAuth") {
        await client.request({ op: "cancelOAuth", requestId: operation.requestId });
        state.authorization.status = "cancelled";
      } else if (state.authorization.status === "pending") {
        const result = await client.request({ op: "pollOAuth", requestId: operation.requestId });
        if (!record(result) || !["pending", "connected", "failed", "expired"].includes(result.status as string)) fail();
        state.authorization.status = result.status as "pending" | "connected" | "failed" | "expired";
        if (result.status === "connected") {
          if (!isGitHubOAuthConnection(result.connection)) fail("github_connection_changed");
          state.connection = result.connection;
        }
      }
    } else {
      const connection = await refreshConnection(client, state);
      if (!connection || !state.connection || connection.id !== state.connection.id || connection.accountId !== state.connection.accountId
        || connection.login !== state.connection.login) fail("github_connection_changed");
      if (operation.op === "prepareTestIssue") {
        if (state.receipt) return project(state, client.callbackUrl);
        if (!state.draft) {
          const requestId = randomUUID(), canonical = makeTestIssueInput(requestId);
          state.draft = { id: randomUUID(), requestId, connectionId: connection.id, accountId: connection.accountId, login: connection.login,
            input: canonical, inputHash: inputHash(canonical), createdAt: new Date().toISOString() };
        }
      } else {
        const draft = state.draft;
        if (!draft || draft.connectionId !== connection.id || draft.accountId !== connection.accountId || draft.login !== connection.login
          || draft.inputHash !== inputHash(draft.input)) fail("github_draft_changed");
        if (operation.op === "createTestIssue") {
          if (draft.id !== operation.draftId) fail("github_draft_changed");
          state.receipt = { id: draft.requestId, draftId: draft.id, requestId: draft.requestId, connectionId: connection.id,
            accountId: connection.accountId, login: connection.login, status: "pending", createdAt: new Date().toISOString(), auditPersisted: false, readbackVerified: false };
          saveState(dir, state);
          try { state.receipt = applyReceiptData(state.receipt, await client.request({ op: "createTestIssue", connectionId: connection.id, requestId: draft.requestId, input: draft.input })); }
          catch { state.receipt = { ...state.receipt, status: "unknown", completedAt: new Date().toISOString(), code: "github_write_unknown", auditPersisted: false, readbackVerified: false }; }
        } else {
          const receipt = state.receipt;
          if (!receipt || operation.receiptId !== receipt.id) fail("github_request_conflict");
          try { state.receipt = applyReceiptData(receipt, await client.request({ op: "reconcileIssue", connectionId: connection.id, requestId: draft.requestId, input: draft.input, ...(receipt.issue ? { issueNumber: receipt.issue.number } : {}) })); }
          catch { state.receipt = { ...receipt, status: "unknown", code: "github_readback_unavailable", completedAt: new Date().toISOString(), readbackVerified: false }; }
        }
      }
    }
    saveState(dir, state);
    return project(state, client.callbackUrl);
  });
}
