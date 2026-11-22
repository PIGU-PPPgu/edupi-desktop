import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("../app/api/edupi/cloud/route.ts");
const desktopAuth = await jiti.import("./desktop-api-auth.ts");
const boundedJson = await jiti.import("./bounded-form-data.ts");
const requestSecurity = await jiti.import("./request-security.ts");
const { EduPiCloudError } = await jiti.import("./edupi-cloud-client.ts");
const compiledRoute = ts.transpileModule(
  fs.readFileSync(new URL("../app/api/edupi/cloud/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadRoute(client) {
  const modules = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/desktop-api-auth": desktopAuth,
    "@/lib/bounded-form-data": boundedJson,
    "@/lib/request-security": requestSecurity,
    "@/lib/edupi-cloud-client": { createEduPiCloudClient: () => client, EduPiCloudError },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiledRoute)(name => {
    assert.ok(Object.hasOwn(modules, name), name);
    return modules[name];
  }, result, result.exports);
  return result.exports;
}

const token = "desktop-token-for-route-test-012345678901234567890123";

function request(method, body, headers = {}) {
  return new Request("http://localhost:30141/api/edupi/cloud", {
    method,
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function setEnvironment(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function stateFixture(overrides = {}) {
  return {
    version: 2,
    installationId: "installation-1",
    issuer: null,
    generation: 1,
    mode: "cloud",
    workspaceId: "workspace-1",
    session: {
      id: "session-1",
      accessToken: "access-token-that-must-never-leave-the-route",
      refreshToken: "refresh-token-that-must-never-leave-the-route",
      expiresAt: "2030-01-01T00:00:00.000Z",
      user: { id: "teacher-1", email: "teacher@example.invalid" },
    },
    outbox: [
      {
        id: "pending-1",
        issuer: "https://edupi.example",
        accountId: "teacher-1",
        workspaceId: "workspace-1",
        fingerprint: "fingerprint-1",
        operation: "command",
        body: {},
        createdAt: "2026-11-22T00:00:00.000Z",
        attempts: 0,
        lastError: null,
        status: "pending",
      },
      {
        id: "conflict-1",
        issuer: "https://edupi.example",
        accountId: "teacher-1",
        workspaceId: "workspace-1",
        fingerprint: "fingerprint-2",
        operation: "command",
        body: {},
        createdAt: "2026-11-22T00:00:00.000Z",
        attempts: 1,
        lastError: "conflict",
        status: "conflict",
      },
      {
        id: "failed-1",
        issuer: "https://edupi.example",
        accountId: "teacher-1",
        workspaceId: "workspace-1",
        fingerprint: "fingerprint-3",
        operation: "command",
        body: {},
        createdAt: "2026-11-22T00:00:00.000Z",
        attempts: 1,
        lastError: "failed",
        status: "failed",
      },
    ],
    completed: [],
    cursors: {},
    ...overrides,
  };
}

function writeCloudState(stateDir, overrides = {}) {
  const cloudDir = path.join(stateDir, "cloud");
  fs.mkdirSync(cloudDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(cloudDir, "cloud-private.json"),
    JSON.stringify(stateFixture(overrides)), { mode: 0o600 });
}

test("cloud route rejects GET and POST without the desktop token", async () => {
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    assert.equal((await GET(request("GET"))).status, 403);
    for (const action of ["set_mode", "login", "refresh", "logout", "list_workspaces", "select_workspace", "sync", "dashboard"]) {
      assert.equal((await POST(request("POST", { action }))).status, 403, action);
    }
    assert.equal((await GET(request("GET", null, { "x-pi-desktop-token": "wrong" }))).status, 403);
    assert.equal((await POST(request("POST", { action: "sync" }, { "x-pi-desktop-token": "wrong" }))).status, 403);
  } finally {
    restore();
  }
});

test("an unset desktop token never permits Host-only or caller-token cloud access", async () => {
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: undefined });
  try {
    const headers = { "x-pi-desktop-token": token };
    assert.equal((await GET(request("GET", null, headers))).status, 403);
    assert.equal((await POST(request("POST", { action: "logout" }, headers))).status, 403);
  } finally {
    restore();
  }
});

test("a valid desktop token still rejects LAN and cross-origin requests", async () => {
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    for (const headers of [
      { host: "192.168.1.10:30141", origin: "http://192.168.1.10:30141" },
      { origin: "https://example.invalid" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const credentials = { ...headers, "x-pi-desktop-token": token };
      assert.equal((await GET(request("GET", null, credentials))).status, 403);
      assert.equal((await POST(request("POST", { action: "sync" }, credentials))).status, 403);
    }
  } finally {
    restore();
  }
});

test("cloud GET keeps local state and safe sync counts when the network is offline", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-route-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  writeCloudState(stateDir);
  const restore = setEnvironment({
    PI_DESKTOP_API_TOKEN: token,
    PI_DESKTOP_STATE_DIR: stateDir,
    SUPABASE_URL: "https://edupi.example",
    SUPABASE_ANON_KEY: "public-test-key",
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  try {
    const response = await GET(request("GET", null, { "x-pi-desktop-token": token }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.session.state, "signed_in");
    assert.equal(body.generation, 1);
    assert.deepEqual(body.sync, { pending: 1, conflict: 1, failed: 1 });
    assert.equal(body.error.code, "network_unavailable");
    assert.equal(typeof body.error.message, "string");
    assert.equal(JSON.stringify(body).includes("access-token-that-must-never-leave-the-route"), false);
    assert.equal(JSON.stringify(body).includes("refresh-token-that-must-never-leave-the-route"), false);
    assert.match(response.headers.get("cache-control"), /no-store/u);
    const local = await POST(request("POST", { action: "set_mode", mode: "local" }, { "x-pi-desktop-token": token }));
    assert.equal(local.status, 200);
    assert.equal((await local.json()).mode, "local");
    const reread = await GET(request("GET", null, { "x-pi-desktop-token": token }));
    assert.equal((await reread.json()).mode, "local");
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("expired sessions return local status without trying workspace discovery", async () => {
  const state = stateFixture();
  state.session.expiresAt = "2000-01-01T00:00:00.000Z";
  let discovered = false;
  const route = loadRoute({
    state: async () => state,
    config: () => ({ configured: true }),
    listWorkspaces: async () => { discovered = true; throw new Error("must not discover"); },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.GET(request("GET", null, { "x-pi-desktop-token": token }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "cloud");
    assert.equal(body.session.state, "expired");
    assert.equal(discovered, false);
    assert.deepEqual(body.sync, { pending: 1, conflict: 1, failed: 1 });
  } finally {
    restore();
  }
});

test("GET uses the no-argument workspace API and never reads or returns credentials", async () => {
  const state = stateFixture({ outbox: [] });
  Object.defineProperty(state.session, "secret", { get() { throw new Error("secret must not be read"); } });
  Object.defineProperty(state.session, "accessToken", { get() { throw new Error("access token must not be read"); } });
  Object.defineProperty(state.session.user, "secret", { get() { throw new Error("user secrets must not be read"); } });
  const route = loadRoute({
    state: async () => state,
    config: () => ({ configured: true }),
    listWorkspaces: async (...args) => {
      assert.equal(args.length, 0);
      return [{ id: "workspace-1", mode: "cloud", secret: "must-not-leak" }];
    },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.GET(request("GET", null, { "x-pi-desktop-token": token }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.workspaces, [{ id: "workspace-1", mode: "cloud" }]);
    assert.deepEqual(Object.keys(body.session).sort(), ["expiresAt", "state", "user"]);
    assert.deepEqual(Object.keys(body.session.user).sort(), ["email", "id"]);
    assert.equal(body.error, null);
  } finally {
    restore();
  }
});

test("a rejected remote session is shown as expired even before its saved expiry time", async () => {
  const route = loadRoute({
    state: async () => stateFixture({ outbox: [] }),
    config: () => ({ configured: true }),
    listWorkspaces: async () => { throw new EduPiCloudError("unknown_upstream_code", "sensitive upstream message", 401); },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.GET(request("GET", null, { "x-pi-desktop-token": token }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.session.state, "expired");
    assert.equal(body.error.code, "unauthorized");
    assert.equal(JSON.stringify(body).includes("sensitive"), false);
    assert.equal(JSON.stringify(body).includes("unknown_upstream_code"), false);
  } finally {
    restore();
  }
});

test("configuration failures preserve signed-out local status and hide raw messages", async () => {
  const route = loadRoute({
    state: async () => stateFixture({ mode: "local", session: null, workspaceId: null, outbox: [] }),
    config: () => { throw new EduPiCloudError("configuration_invalid", "private environment contents"); },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.GET(request("GET", null, { "x-pi-desktop-token": token }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.session.state, "signed_out");
    assert.equal(body.mode, "local");
    assert.equal(body.configured, false);
    assert.equal(body.error.code, "configuration_invalid");
    assert.equal(JSON.stringify(body).includes("private environment"), false);
  } finally {
    restore();
  }
});

test("POST failures expose only bounded codes and fixed safe messages", async () => {
  const route = loadRoute({
    persistMode: async () => { throw new EduPiCloudError("raw_private_upstream_code", "private request body", 599); },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.POST(request("POST", { action: "set_mode", mode: "local" }, { "x-pi-desktop-token": token }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "cloud_unavailable", error: "云端操作暂不可用，请重试。" });
  } finally {
    restore();
  }
});

test("unsupported cloud contracts expose an explicit safe update message", async () => {
  const route = loadRoute({
    dashboard: async () => { throw new EduPiCloudError("unsupported_contract", "private upstream response", 502); },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.POST(request("POST", { action: "dashboard" }, { "x-pi-desktop-token": token }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      code: "unsupported_contract",
      error: "云端接口版本与当前客户端不匹配，请更新后重试。",
    });
  } finally {
    restore();
  }
});

test("sync invokes flushOutbox and returns the reread queue counts", async () => {
  const state = stateFixture();
  let flushes = 0;
  const route = loadRoute({
    state: async () => state,
    config: () => ({ configured: true }),
    flushOutbox: async () => {
      flushes++;
      state.outbox = state.outbox.filter(entry => entry.status !== "pending");
      return { flushed: 1, pending: state.outbox.length };
    },
  });
  const restore = setEnvironment({ PI_DESKTOP_API_TOKEN: token });
  try {
    const response = await route.POST(request("POST", { action: "sync" }, { "x-pi-desktop-token": token }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(flushes, 1);
    assert.equal(body.flushed, 1);
    assert.deepEqual(body.sync, { pending: 0, conflict: 1, failed: 1 });
    assert.equal(Object.hasOwn(body, "outbox"), false);
  } finally {
    restore();
  }
});

test("login remains local until the user explicitly selects a workspace", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-route-login-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const restore = setEnvironment({
    PI_DESKTOP_API_TOKEN: token,
    PI_DESKTOP_STATE_DIR: stateDir,
    SUPABASE_URL: "https://edupi.example",
    SUPABASE_ANON_KEY: "public-test-key",
    EDUPI_WORKSPACE_ID: undefined,
    EDUPI_DATA_MODE: undefined,
  });
  const previousFetch = globalThis.fetch;
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v1/token")) return Response.json({
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
      expires_in: 3600,
      user: { id: "11111111-1111-4111-8111-111111111111", email: "teacher@example.invalid" },
    });
    if (String(url).includes("/functions/v1/edupi-account")) return Response.json({
      workspaces: [{ id: workspaceId, mode: "cloud" }],
    });
    return new Response(null, { status: 204 });
  };
  try {
    const headers = { "x-pi-desktop-token": token };
    const login = await POST(request("POST", { action: "login", email: "teacher@example.invalid", password: "synthetic-password" }, headers));
    const loggedIn = await login.json();
    assert.equal(login.status, 200);
    assert.equal(loggedIn.mode, "local");
    assert.equal(loggedIn.workspaceId, null);
    assert.equal(loggedIn.session.state, "signed_in");
    assert.equal(JSON.stringify(loggedIn).includes("synthetic-access-token"), false);
    assert.equal(JSON.stringify(loggedIn).includes("synthetic-refresh-token"), false);
    assert.equal((await POST(request("POST", { action: "set_mode", mode: "cloud" }, headers))).status, 409);
    const selected = await POST(request("POST", { action: "select_workspace", workspace_id: workspaceId }, headers));
    assert.equal(selected.status, 200);
    assert.equal((await selected.json()).mode, "cloud");
    const reread = await GET(request("GET", null, headers));
    assert.equal((await reread.json()).workspaceId, workspaceId);
    const logout = await POST(request("POST", { action: "logout" }, headers));
    const signedOut = await logout.json();
    assert.equal(signedOut.mode, "local");
    assert.equal(signedOut.session.state, "signed_out");
    assert.equal(signedOut.workspaceId, null);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});
