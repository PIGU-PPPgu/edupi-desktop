export const GITHUB_TEST_OWNER = "PIGU-PPPgu";
export const GITHUB_TEST_REPO = "edupi-desktop";
export const GITHUB_OAUTH_SCOPES = ["public_repo"] as const;
export const GITHUB_TEST_ACTION = "github.create_issue" as const;

export type GitHubOAuthConnection = {
  id: string;
  login: string;
  accountId: string;
  scopes: string[];
  authType: "oauth2";
};
export type GitHubOAuthRequest = {
  requestId: string;
  authorizationUrl: string;
  expiresAt: string;
  status: "pending" | "connected" | "failed" | "expired" | "cancelled";
};
export type GitHubTestIssueInput = { owner: typeof GITHUB_TEST_OWNER; repo: typeof GITHUB_TEST_REPO; title: string; body: string };
export type GitHubTestIssueDraft = {
  id: string;
  requestId: string;
  connectionId: string;
  accountId: string;
  login: string;
  input: GitHubTestIssueInput;
  inputHash: string;
  createdAt: string;
};
export type GitHubTestIssue = { number: number; url: string; title: string; body: string; state: "open" | "closed"; author: string };
export type GitHubTestIssueReceipt = {
  id: string;
  draftId: string;
  requestId: string;
  connectionId: string;
  accountId: string;
  login: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  createdAt: string;
  completedAt?: string;
  issue?: GitHubTestIssue;
  writeExecutionId?: string;
  readExecutionId?: string;
  auditPersisted: boolean;
  readbackVerified: boolean;
  code?: string;
};
export type GitHubOAuthStatus = {
  supported: boolean;
  clientConfigured: boolean;
  clientId: string | null;
  callbackUrl: string | null;
  authorization: GitHubOAuthRequest | null;
  connection: GitHubOAuthConnection | null;
  draft: GitHubTestIssueDraft | null;
  receipt: GitHubTestIssueReceipt | null;
};
export type GitHubOAuthOperation =
  | { op: "configureOAuth"; clientId: string; clientSecret: string }
  | { op: "startOAuth" }
  | { op: "pollOAuth"; requestId: string }
  | { op: "cancelOAuth"; requestId: string }
  | { op: "prepareTestIssue" }
  | { op: "createTestIssue"; draftId: string }
  | { op: "readIssue"; receiptId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;
export function isGitHubRequestId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function only(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function timestamp(value: unknown): value is string { return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function login(value: unknown): value is string { return typeof value === "string" && LOGIN.test(value); }
function accountId(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value); }
export function isGitHubOAuthClientId(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{20}|(?:Iv1\.|Ov23li)[A-Za-z0-9]{10,80})$/u.test(value);
}

export function makeTestIssueInput(requestId: string): GitHubTestIssueInput {
  if (!isGitHubRequestId(requestId)) throw new Error("invalid_github_request");
  return {
    owner: GITHUB_TEST_OWNER,
    repo: GITHUB_TEST_REPO,
    title: `[EduPi OAuth TEST] ${requestId}`,
    body: `EduPi OpenConnector 本机 OAuth 与写入验收测试。\n\n仅包含测试内容，不涉及教师或学生资料。\n\n验收标记：edupi-openconnector-test:${requestId}`,
  };
}

export function parseGitHubOAuthOperation(value: unknown): GitHubOAuthOperation | null {
  if (!object(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  if (value.op === "configureOAuth" && keys === "clientId,clientSecret,op"
    && isGitHubOAuthClientId(value.clientId)
    && typeof value.clientSecret === "string" && /^[A-Za-z0-9_.-]{16,256}$/u.test(value.clientSecret)) {
    return { op: "configureOAuth", clientId: value.clientId, clientSecret: value.clientSecret };
  }
  if (keys === "op") {
    if (value.op === "startOAuth" || value.op === "prepareTestIssue") return { op: value.op };
  }
  if ((value.op === "pollOAuth" || value.op === "cancelOAuth") && keys === "op,requestId" && isGitHubRequestId(value.requestId)) return { op: value.op, requestId: value.requestId };
  if (value.op === "createTestIssue" && keys === "draftId,op" && isGitHubRequestId(value.draftId)) return { op: "createTestIssue", draftId: value.draftId };
  if (value.op === "readIssue" && keys === "op,receiptId" && isGitHubRequestId(value.receiptId)) return { op: "readIssue", receiptId: value.receiptId };
  return null;
}

export function isGitHubOAuthConnection(value: unknown): value is GitHubOAuthConnection {
  return object(value) && only(value, ["id", "login", "accountId", "scopes", "authType"]) && isGitHubRequestId(value.id) && login(value.login) && accountId(value.accountId)
    && value.authType === "oauth2" && Array.isArray(value.scopes) && value.scopes.length === 1 && value.scopes[0] === "public_repo";
}

export function isGitHubCallbackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port || "80") > 0
      && url.pathname === "/oauth/callback" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function isGitHubOAuthRequest(value: unknown): value is GitHubOAuthRequest {
  if (!object(value) || !only(value, ["requestId", "authorizationUrl", "expiresAt", "status"]) || !isGitHubRequestId(value.requestId) || !timestamp(value.expiresAt)
    || !["pending", "connected", "failed", "expired", "cancelled"].includes(value.status as string)
    || typeof value.authorizationUrl !== "string" || value.authorizationUrl.length > 4096) return false;
  try {
    const url = new URL(value.authorizationUrl);
    return url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize" && !url.username && !url.password && !url.hash
      && !url.searchParams.has("client_secret") && !url.searchParams.has("access_token");
  } catch { return false; }
}

export function isGitHubTestIssueDraft(value: unknown): value is GitHubTestIssueDraft {
  if (!object(value) || !only(value, ["id", "requestId", "connectionId", "accountId", "login", "input", "inputHash", "createdAt"]) || !isGitHubRequestId(value.id) || !isGitHubRequestId(value.requestId) || !isGitHubRequestId(value.connectionId)
    || !accountId(value.accountId) || !login(value.login) || !timestamp(value.createdAt)
    || typeof value.inputHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.inputHash) || !object(value.input)) return false;
  return JSON.stringify(value.input) === JSON.stringify(makeTestIssueInput(value.requestId));
}

export function isGitHubTestIssue(value: unknown, requestId?: string): value is GitHubTestIssue {
  if (!object(value) || !only(value, ["number", "url", "title", "body", "state", "author"]) || !Number.isSafeInteger(value.number) || (value.number as number) < 1
    || value.url !== `https://github.com/${GITHUB_TEST_OWNER}/${GITHUB_TEST_REPO}/issues/${value.number}`
    || typeof value.title !== "string" || value.title.length > 250 || typeof value.body !== "string" || value.body.length > 4096
    || !["open", "closed"].includes(value.state as string) || !login(value.author)) return false;
  if (requestId) {
    const input = makeTestIssueInput(requestId);
    if (value.title !== input.title || value.body !== input.body) return false;
  }
  return true;
}

export function isGitHubTestIssueReceipt(value: unknown): value is GitHubTestIssueReceipt {
  if (!object(value) || !only(value, ["id", "draftId", "requestId", "connectionId", "accountId", "login", "status", "createdAt", "completedAt", "issue", "writeExecutionId", "readExecutionId", "auditPersisted", "readbackVerified", "code"]) || !isGitHubRequestId(value.id) || !isGitHubRequestId(value.draftId) || !isGitHubRequestId(value.requestId)
    || !isGitHubRequestId(value.connectionId) || !accountId(value.accountId) || !login(value.login) || !timestamp(value.createdAt)
    || !["pending", "succeeded", "failed", "unknown"].includes(value.status as string)
    || typeof value.auditPersisted !== "boolean" || typeof value.readbackVerified !== "boolean"
    || value.completedAt !== undefined && !timestamp(value.completedAt)
    || value.writeExecutionId !== undefined && !isGitHubRequestId(value.writeExecutionId)
    || value.readExecutionId !== undefined && !isGitHubRequestId(value.readExecutionId)
    || value.code !== undefined && (typeof value.code !== "string" || !/^[a-z_]{1,80}$/u.test(value.code))
    || value.issue !== undefined && (!isGitHubTestIssue(value.issue, value.requestId) || value.issue.author.toLowerCase() !== (value.login as string).toLowerCase())) return false;
  return value.status !== "succeeded" || Boolean(value.completedAt && value.issue && value.writeExecutionId && value.readExecutionId && value.auditPersisted && value.readbackVerified);
}

export function isGitHubOAuthStatus(value: unknown): value is GitHubOAuthStatus {
  return object(value) && typeof value.supported === "boolean" && typeof value.clientConfigured === "boolean"
    && (value.clientId === null || isGitHubOAuthClientId(value.clientId))
    && (value.callbackUrl === null || isGitHubCallbackUrl(value.callbackUrl))
    && (value.authorization === null || isGitHubOAuthRequest(value.authorization))
    && (value.connection === null || isGitHubOAuthConnection(value.connection))
    && (value.draft === null || isGitHubTestIssueDraft(value.draft))
    && (value.receipt === null || isGitHubTestIssueReceipt(value.receipt));
}
