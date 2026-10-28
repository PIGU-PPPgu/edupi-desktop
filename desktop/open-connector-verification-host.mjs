import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "http://127.0.0.1:32999";
const ACTION = "github.get_current_user";
const MAX_BYTES = 32 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;

function localProxy(value) {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    const port = Number(url.port || "80");
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && Number.isInteger(port) && port > 0 && port <= 65_535 && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

export function isVerificationNetwork(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => ["httpProxy", "httpsProxy", "noProxy"].includes(key))
    && (value.httpProxy !== undefined || value.httpsProxy !== undefined)
    && (value.httpProxy === undefined || localProxy(value.httpProxy))
    && (value.httpsProxy === undefined || localProxy(value.httpsProxy))
    && typeof value.noProxy === "string" && value.noProxy.length <= 2048
    && !/[\u0000-\u001f\u007f]/u.test(value.noProxy);
}

/** Use the existing desktop network configuration for this isolated host only. */
export async function configureVerificationNetwork(network) {
  if (network === undefined) return async () => {};
  if (!isVerificationNetwork(network)) throw new Error("invalid_verification_network");
  const { EnvHttpProxyAgent, fetch, getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
  const originalDispatcher = getGlobalDispatcher();
  const originalFetch = globalThis.fetch;
  const agent = new EnvHttpProxyAgent(network);
  setGlobalDispatcher(agent);
  globalThis.fetch = fetch;
  return async () => {
    globalThis.fetch = originalFetch;
    setGlobalDispatcher(originalDispatcher);
    await agent.close();
  };
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_response");
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("invalid_response");
      }
      parts.push(item.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

function validRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.id !== "string" || !UUID.test(value.id)
    || typeof value.credential !== "string" || value.credential.length < 16 || value.credential.length > 4096
    || /[\s\u0000-\u001f\u007f]/u.test(value.credential)) return false;
  if (value.network !== undefined && !isVerificationNetwork(value.network)) return false;
  const keys = Object.keys(value).filter((key) => key !== "network").sort().join(",");
  if (value.op === "connect") return keys === "credential,id,op";
  return value.op === "verify" && keys === "credential,expectedAccountId,id,op,requestId"
    && typeof value.expectedAccountId === "string" && LOGIN.test(value.expectedAccountId)
    && typeof value.requestId === "string" && UUID.test(value.requestId);
}

/** Fixed management probe: no caller-selected provider, URL, input or action. */
export async function runGitHubVerification(runtime, request, tokens, { signal } = {}) {
  if (!validRequest(request)) return { id: null, ok: false, code: "invalid_verification_request" };
  const call = async (path, token, init = {}) => {
    const response = await runtime.fetch(new Request(new URL(path, ORIGIN), {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      signal,
    }));
    return { ok: response.ok, body: await readJson(response) };
  };
  let connection;
  try {
    const reply = await call("/v1/connections/github/connect/api-key", tokens.adminToken, {
      method: "POST", body: JSON.stringify({ apiKey: request.credential }),
    });
    const value = reply.body?.data;
    if (!reply.ok || reply.body?.success !== true || value?.service !== "github" || value.status !== "active"
      || typeof value.providerAccountId !== "string" || !LOGIN.test(value.providerAccountId)
      || typeof value.id !== "string" || !UUID.test(value.id)
      || typeof value.alias !== "string" || !UUID.test(value.alias)) {
      return { id: request.id, ok: false, code: "github_authorization_failed" };
    }
    connection = { id: value.id, alias: value.alias, login: value.providerAccountId, accountId: value.providerAccountId.toLowerCase() };
  } catch {
    return { id: request.id, ok: false, code: "github_connection_unavailable" };
  }
  const account = { accountId: connection.accountId, login: connection.login, htmlUrl: `https://github.com/${connection.login}` };
  if (request.op === "connect") return { id: request.id, ok: true, data: { account } };
  if (connection.accountId !== request.expectedAccountId.toLowerCase()) {
    return { id: request.id, ok: false, code: "github_account_changed" };
  }

  let execution;
  let executionId;
  try {
    execution = await call(`/v1/actions/${ACTION}`, tokens.runtimeToken, {
      method: "POST",
      headers: { "Idempotency-Key": request.requestId, "x-oo-connector-alias": connection.alias },
      body: JSON.stringify({ input: {} }),
    });
    const candidate = execution.body?.meta?.executionId;
    if (typeof candidate === "string" && UUID.test(candidate)) executionId = candidate;
  } catch {
    return { id: request.id, ok: true, data: { status: "unknown", code: "github_execution_unknown", auditPersisted: false } };
  }
  if (!executionId) {
    return { id: request.id, ok: true, data: { status: execution.ok ? "unknown" : "failed", code: execution.ok ? "github_audit_unavailable" : "github_execution_failed", auditPersisted: false } };
  }
  let audit;
  try {
    audit = await call(`/api/runs/${executionId}`, tokens.adminToken);
    if (!audit.ok || audit.body?.id !== executionId || audit.body?.service !== "github" || audit.body?.actionId !== ACTION
      || audit.body?.connectionId !== connection.id || typeof audit.body?.ok !== "boolean"
      || execution.body?.meta?.auditPersisted !== true) throw new Error("audit_mismatch");
  } catch {
    return { id: request.id, ok: true, data: { status: "unknown", executionId, code: "github_audit_unavailable", auditPersisted: false } };
  }
  if (!execution.ok || execution.body?.success !== true || audit.body.ok !== true) {
    return { id: request.id, ok: true, data: { status: "failed", executionId, code: "github_execution_failed", auditPersisted: true } };
  }
  const profile = execution.body.data;
  if (typeof profile?.login !== "string" || profile.login.toLowerCase() !== connection.accountId
    || !Number.isSafeInteger(profile.id) || profile.id <= 0
    || !Number.isSafeInteger(profile.public_repos) || profile.public_repos < 0
    || profile.html_url !== `https://github.com/${profile.login}`) {
    return { id: request.id, ok: true, data: { status: "unknown", executionId, code: "github_result_mismatch", auditPersisted: true } };
  }
  return { id: request.id, ok: true, data: {
    status: "succeeded", executionId, auditPersisted: true,
    profile: { login: profile.login, id: profile.id, htmlUrl: profile.html_url, publicRepos: profile.public_repos },
  } };
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir || !isAbsolute(dataDir)) throw new Error("invalid_data_directory");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const stats = await lstat(dataDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("invalid_data_directory");
  await chmod(dataDir, 0o700);
  let bytes = 0;
  const parts = [];
  for await (const incoming of process.stdin) {
    bytes += incoming.length;
    if (bytes > 8192) throw new Error("invalid_request");
    parts.push(incoming);
  }
  const request = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!validRequest(request)) throw new Error("invalid_request");
  const tokens = { adminToken: randomBytes(32).toString("hex"), runtimeToken: randomBytes(32).toString("hex") };
  const closeNetwork = await configureVerificationNetwork(request.network);
  let runtime;
  try {
    const { createConnectorRuntime } = await import("@oomol-lab/open-connector");
    runtime = await createConnectorRuntime({
      dataDir, publicOrigin: ORIGIN, encryptionKey: randomBytes(32).toString("hex"), ...tokens,
      actionPolicy: { allowedActions: [ACTION], blockedProxies: ["*"] },
    });
    const result = await runGitHubVerification(runtime, request, tokens, { signal: AbortSignal.timeout(25_000) });
    const output = JSON.stringify(result);
    if (output.includes(request.credential)) throw new Error("invalid_output");
    process.stdout.write(`${output}\n`);
  } finally {
    try {
      if (runtime) await runtime.close();
    } finally {
      await closeNetwork();
    }
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => { process.stderr.write("OpenConnector verification unavailable\n"); process.exitCode = 1; });
}
