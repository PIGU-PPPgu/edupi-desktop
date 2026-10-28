export const GITHUB_VERIFICATION_ACTION = "github.get_current_user" as const;

export type GitHubVerificationConnection = {
  id: string;
  service: "github";
  accountId: string;
  login: string;
  htmlUrl: string;
  authorizedAt: string;
};

export type GitHubVerificationReceipt = {
  id: string;
  connectionId: string;
  actionId: typeof GITHUB_VERIFICATION_ACTION;
  login: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  startedAt: string;
  completedAt?: string;
  executionId?: string;
  auditPersisted: boolean;
  profile?: { login: string; id: number; htmlUrl: string; publicRepos: number };
  code?: string;
};

export type GitHubVerificationStatus = {
  supported: boolean;
  connection: GitHubVerificationConnection | null;
  receipt: GitHubVerificationReceipt | null;
};

export type GitHubVerificationOperation =
  | { op: "connect" }
  | { op: "verify"; connectionId: string; requestId: string }
  | { op: "disconnect"; connectionId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function parseGitHubVerificationOperation(value: unknown): GitHubVerificationOperation | null {
  if (!record(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  if (value.op === "connect" && keys === "op") return { op: "connect" };
  if (typeof value.connectionId !== "string" || !UUID.test(value.connectionId)) return null;
  if (value.op === "disconnect" && keys === "connectionId,op") return { op: "disconnect", connectionId: value.connectionId };
  if (value.op === "verify" && keys === "connectionId,op,requestId" && typeof value.requestId === "string" && UUID.test(value.requestId)) {
    return { op: "verify", connectionId: value.connectionId, requestId: value.requestId };
  }
  return null;
}

export function isGitHubVerificationConnection(value: unknown): value is GitHubVerificationConnection {
  if (!record(value)) return false;
  return typeof value.id === "string" && UUID.test(value.id) && value.service === "github"
    && typeof value.login === "string" && LOGIN.test(value.login)
    && typeof value.accountId === "string" && value.accountId === value.login.toLowerCase()
    && value.htmlUrl === `https://github.com/${value.login}` && timestamp(value.authorizedAt);
}

export function isGitHubVerificationReceipt(value: unknown): value is GitHubVerificationReceipt {
  if (!record(value) || typeof value.id !== "string" || !UUID.test(value.id)
    || typeof value.connectionId !== "string" || !UUID.test(value.connectionId)
    || value.actionId !== GITHUB_VERIFICATION_ACTION || typeof value.login !== "string" || !LOGIN.test(value.login)
    || !["pending", "succeeded", "failed", "unknown"].includes(value.status as string)
    || !timestamp(value.startedAt) || typeof value.auditPersisted !== "boolean"
    || (value.completedAt !== undefined && !timestamp(value.completedAt))
    || (value.executionId !== undefined && (typeof value.executionId !== "string" || !UUID.test(value.executionId)))
    || (value.code !== undefined && (typeof value.code !== "string" || !/^[a-z_]{1,80}$/u.test(value.code)))) return false;
  if (value.profile !== undefined) {
    const profile = value.profile;
    if (!record(profile) || profile.login !== value.login || profile.htmlUrl !== `https://github.com/${value.login}`
      || !Number.isSafeInteger(profile.id) || (profile.id as number) <= 0
      || !Number.isSafeInteger(profile.publicRepos) || (profile.publicRepos as number) < 0) return false;
  }
  return value.status !== "succeeded" || Boolean(value.executionId && value.auditPersisted && value.profile && value.completedAt);
}

export function isGitHubVerificationStatus(value: unknown): value is GitHubVerificationStatus {
  return record(value) && typeof value.supported === "boolean"
    && (value.connection === null || isGitHubVerificationConnection(value.connection))
    && (value.receipt === null || isGitHubVerificationReceipt(value.receipt));
}
