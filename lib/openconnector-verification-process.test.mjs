import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  readGitHubVerificationStatus, runGitHubVerificationOperation,
} = await createJiti(import.meta.url).import("./openconnector-verification-process.ts");
const credential = "hermetic-credential-that-must-never-leak";
const account = { login: "example-user", accountId: "example-user", htmlUrl: "https://github.com/example-user" };
const profile = { login: account.login, id: 123, htmlUrl: account.htmlUrl, publicRepos: 5 };

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "edupi-connector-state-test-"));
  await writeFile(path.join(root, "verification-host.mjs"), "// hermetic test host marker\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const options = {
    stateDir: root, root, platform: "darwin", getCredential: async () => credential,
    proxyEnv: {}, readSystemProxy: async () => undefined,
    runHost: async (request) => {
      calls.push(request);
      return request.op === "connect" ? { id: request.id, ok: true, data: { account: { ...account, token: credential } } }
        : { id: request.id, ok: true, data: { status: "succeeded", executionId: randomUUID(), auditPersisted: true, profile: { ...profile, email: "do-not-persist@example.test", credential } } };
    },
  };
  return { root, options, calls };
}

test("authorization identity and audited receipt survive reread without persisting credentials or profile extras", async (t) => {
  const { root, options, calls } = await fixture(t);
  const connected = await runGitHubVerificationOperation({ op: "connect" }, options);
  assert.equal(connected.connection.login, account.login);
  assert.equal("credentialFingerprint" in connected.connection, false);
  assert.equal("token" in connected.connection, false);
  const operation = { op: "verify", connectionId: connected.connection.id, requestId: randomUUID() };
  const result = await runGitHubVerificationOperation(operation, options);
  assert.equal(result.receipt.status, "succeeded");
  assert.deepEqual(result.receipt.profile, profile);
  assert.equal(result.receipt.auditPersisted, true);
  assert.equal(calls.length, 2);
  const status = await readGitHubVerificationStatus(options);
  assert.deepEqual(status, result);
  const stateBytes = await readFile(path.join(root, "openconnector-read-verification/state.json"), "utf8");
  const receiptBytes = await readFile(path.join(root, `openconnector-read-verification/receipts/${operation.requestId}.json`), "utf8");
  assert.match(stateBytes, /credentialFingerprint/u);
  assert.equal(stateBytes.includes(credential), false);
  assert.doesNotMatch(receiptBytes, /do-not-persist|credential|email/u);
  assert.equal(JSON.stringify(status).includes("ownerProcessId"), false);
});

test("detected network travels only in private stdin; explicit unsafe proxies fail before credential access", async (t) => {
  const { options, calls } = await fixture(t);
  const network = { httpProxy: "http://127.0.0.1:7897", httpsProxy: "http://127.0.0.1:7897", noProxy: "localhost,127.0.0.1" };
  await runGitHubVerificationOperation({ op: "connect" }, { ...options, readSystemProxy: async () => network });
  assert.deepEqual(calls[0].network, network);
  let credentialsRead = 0;
  await assert.rejects(runGitHubVerificationOperation({ op: "connect" }, {
    ...options, proxyEnv: { HTTPS_PROXY: "http://user:private@remote.example:8080" }, getCredential: async () => { credentialsRead += 1; return credential; },
  }), { code: "github_proxy_unsupported" });
  assert.equal(credentialsRead, 0);
  let systemRead = false;
  await runGitHubVerificationOperation({ op: "connect" }, {
    ...options, proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:9999", NO_PROXY: "*.internal" }, readSystemProxy: async () => { systemRead = true; return network; },
  });
  assert.equal(systemRead, false);
  assert.equal(calls.at(-1).network.httpsProxy, "http://127.0.0.1:9999");
  assert.match(calls.at(-1).network.noProxy, /\*\.internal/u);
  await runGitHubVerificationOperation({ op: "connect" }, {
    ...options, proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:80" },
  });
  assert.equal(calls.at(-1).network.httpsProxy, "http://127.0.0.1");
  const prepare = await readFile(new URL("../scripts/prepare-desktop.mjs", import.meta.url), "utf8");
  assert.match(prepare, /copyPackageClosure\(rootDir, openConnectorResourcesDir, "undici"\)/u);
});

test("same request ID only rereads receipt, stale connections and credential rotations never dispatch", async (t) => {
  const { options, calls } = await fixture(t);
  const connected = await runGitHubVerificationOperation({ op: "connect" }, options);
  const operation = { op: "verify", connectionId: connected.connection.id, requestId: randomUUID() };
  const first = await runGitHubVerificationOperation(operation, options);
  const repeated = await runGitHubVerificationOperation(operation, options);
  assert.deepEqual(first, repeated);
  assert.equal(calls.length, 2);
  await assert.rejects(runGitHubVerificationOperation({ ...operation, connectionId: randomUUID() }, options), { code: "github_request_conflict" });
  await assert.rejects(runGitHubVerificationOperation({ ...operation, requestId: randomUUID(), connectionId: randomUUID() }, options), { code: "github_connection_changed" });
  await assert.rejects(runGitHubVerificationOperation({ ...operation, requestId: randomUUID() }, { ...options, getCredential: async () => "another-valid-test-credential" }), { code: "github_connection_changed" });
  assert.equal(calls.length, 2);
});

test("active operations serialize; status observes pending and never changes it to unknown", async (t) => {
  const { options } = await fixture(t);
  const connected = await runGitHubVerificationOperation({ op: "connect" }, options);
  let finish;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const operation = { op: "verify", connectionId: connected.connection.id, requestId: randomUUID() };
  const pending = runGitHubVerificationOperation(operation, { ...options, runHost: async (request) => {
    started();
    return new Promise((resolve) => { finish = () => resolve({ id: request.id, ok: true, data: { status: "succeeded", executionId: randomUUID(), auditPersisted: true, profile } }); });
  } });
  await ready;
  const status = await readGitHubVerificationStatus(options);
  assert.equal(status.receipt.status, "pending");
  await assert.rejects(runGitHubVerificationOperation({ op: "disconnect", connectionId: connected.connection.id }, options), { code: "github_verification_busy" });
  finish();
  assert.equal((await pending).receipt.status, "succeeded");
});

test("interrupted and timed-out calls remain unknown and same request never executes again", async (t) => {
  const { root, options, calls } = await fixture(t);
  const connected = await runGitHubVerificationOperation({ op: "connect" }, options);
  const requestId = randomUUID();
  const operation = { op: "verify", connectionId: connected.connection.id, requestId };
  const receipt = { id: requestId, connectionId: connected.connection.id, actionId: "github.get_current_user", login: account.login,
    status: "pending", startedAt: new Date().toISOString(), auditPersisted: false, ownerProcessId: 99999999 };
  const dir = path.join(root, "openconnector-read-verification");
  const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
  state.latestReceiptId = requestId;
  await writeFile(path.join(dir, "state.json"), JSON.stringify(state), { mode: 0o600 });
  await writeFile(path.join(dir, `receipts/${requestId}.json`), JSON.stringify(receipt), { mode: 0o600 });
  assert.equal((await readGitHubVerificationStatus(options)).receipt.status, "unknown");
  assert.equal((await runGitHubVerificationOperation(operation, options)).receipt.status, "unknown");
  assert.equal(calls.length, 1);
  const timeoutOperation = { ...operation, requestId: randomUUID() };
  const timedOut = await runGitHubVerificationOperation(timeoutOperation, { ...options, runHost: async () => { throw new Error("sensitive-error-must-not-leak"); } });
  assert.equal(timedOut.receipt.status, "unknown");
  assert.equal(timedOut.receipt.code, "github_execution_unknown");
  assert.equal(JSON.stringify(timedOut).includes("sensitive-error"), false);
});

test("disconnect preserves audit receipt; unsupported runtime and arbitrary input are denied", async (t) => {
  const { options } = await fixture(t);
  const connected = await runGitHubVerificationOperation({ op: "connect" }, options);
  const verified = await runGitHubVerificationOperation({ op: "verify", connectionId: connected.connection.id, requestId: randomUUID() }, options);
  const disconnected = await runGitHubVerificationOperation({ op: "disconnect", connectionId: connected.connection.id }, options);
  assert.equal(disconnected.connection, null);
  assert.equal(disconnected.receipt.executionId, verified.receipt.executionId);
  assert.equal((await readGitHubVerificationStatus({ ...options, platform: "linux" })).supported, false);
  assert.equal((await readGitHubVerificationStatus({ ...options, root: "/missing/packaged/root" })).supported, false);
  await assert.rejects(runGitHubVerificationOperation({ op: "connect", credential }, options), { code: "invalid_verification_request" });
  await assert.rejects(runGitHubVerificationOperation({ op: "connect" }, { ...options, platform: "linux" }), { code: "github_verification_unsupported" });
});

test("real child pipe redacts environment, sends credential outside argv, enforces timeout and cleans temporary databases", async (t) => {
  const { root, options } = await fixture(t);
  const fakeGh = path.join(root, "fake-gh");
  await writeFile(fakeGh, `#!${process.execPath}\nif (process.argv.slice(2).join(' ') !== 'auth token --hostname github.com' || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) process.exit(3);\nprocess.stdout.write(${JSON.stringify(credential)});\n`, { mode: 0o700 });
  await chmod(fakeGh, 0o700);
  await writeFile(path.join(root, "verification-host.mjs"), `import fs from 'node:fs';
let text='';for await(const part of process.stdin)text+=part;const r=JSON.parse(text);
if(Object.keys(process.env).some(k=>/TOKEN|KEY|SECRET|AUTH/u.test(k))||process.argv.some(v=>v.includes(r.credential)))process.exit(4);
fs.writeFileSync(process.argv[2]+'/temporary-db-marker','not-a-credential');
fs.writeFileSync(${JSON.stringify(path.join(root, "last-child-directory.json"))},JSON.stringify(process.argv[2]));
if(r.op==='connect')console.log(JSON.stringify({id:r.id,ok:true,data:{account:${JSON.stringify(account)}}}));
else setInterval(()=>{},1000);
`);
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "parent-secret-must-not-reach-CLI-or-host";
  t.after(() => { if (previous === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = previous; });
  const actualOptions = { ...options, getCredential: undefined, runHost: undefined, ghExecutable: fakeGh, timeoutMs: 150 };
  const connected = await runGitHubVerificationOperation({ op: "connect" }, actualOptions);
  assert.equal(connected.connection.login, account.login);
  const firstDirectory = JSON.parse(await readFile(path.join(root, "last-child-directory.json"), "utf8"));
  await assert.rejects(lstat(firstDirectory), { code: "ENOENT" });
  const result = await runGitHubVerificationOperation({ op: "verify", connectionId: connected.connection.id, requestId: randomUUID() }, actualOptions);
  assert.equal(result.receipt.status, "unknown");
  const secondDirectory = JSON.parse(await readFile(path.join(root, "last-child-directory.json"), "utf8"));
  await assert.rejects(lstat(secondDirectory), { code: "ENOENT" });
});
