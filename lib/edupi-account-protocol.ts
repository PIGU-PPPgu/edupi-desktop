import type { AccountAction, AccountIdentity, EduPiAccount } from "./edupi-account-types";

export const ACCOUNT_CONTRACT = "edupi-account-v1";
export class AccountError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export function accountFail(code: string, message: string, status = 400): never { throw new AccountError(code, message, status); }
export const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function text(value: unknown, max = 256, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    return accountFail("invalid_response", "账号服务返回的数据无效。", 502);
  }
  return value;
}
export function opaque(value: unknown, min = 1, max = 512): string {
  const result = text(value, max, min);
  if (!/^[A-Za-z0-9._~+:/=@-]+$/u.test(result)) accountFail("invalid_response", "账号服务返回的数据无效。", 502);
  return result;
}
export function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) accountFail("invalid_response", "账号服务返回的有效期无效。", 502);
  return value as number;
}
export function responseObject(value: unknown): Record<string, unknown> {
  if (!record(value) || value.contract !== ACCOUNT_CONTRACT) accountFail("contract_mismatch", "账号服务版本不兼容。", 502);
  return value;
}
export function parseAccount(value: unknown): EduPiAccount {
  if (!record(value) || !Array.isArray(value.identities) || !value.identities.length || value.identities.length > 12) accountFail("invalid_response", "账号身份信息无效。", 502);
  const identities: AccountIdentity[] = value.identities.map(item => {
    if (!record(item) || !["wechat_miniprogram", "phone", "email"].includes(String(item.kind))) accountFail("invalid_response", "账号身份类型无效。", 502);
    const verifiedAt = text(item.verified_at, 40);
    if (!Number.isFinite(Date.parse(verifiedAt)) || new Date(verifiedAt).toISOString() !== verifiedAt) accountFail("unverified_identity", "账号服务未返回有效的验证记录。", 502);
    return { kind: item.kind as AccountIdentity["kind"], subject: opaque(item.subject, 1, 256), namespace: text(item.namespace, 256),
      label: text(item.label, 256), verifiedAt };
  });
  if (new Set(identities.map(item => `${item.kind}:${item.namespace}:${item.subject}`)).size !== identities.length) accountFail("invalid_response", "账号身份记录重复。", 502);
  return { id: opaque(value.account_id, 1, 160), displayName: text(value.display_name, 160), identities };
}
export function parseAction(value: unknown): AccountAction {
  if (!record(value)) accountFail("invalid_request", "账号操作无效。");
  const allowed = value.action === "start" ? ["action", "purpose"]
    : value.action === "poll" || value.action === "cancel" ? ["action", "flowId"] : ["action"];
  if (Object.keys(value).some(key => !allowed.includes(key))) accountFail("invalid_request", "账号操作包含未知字段。");
  if (value.action === "start" && ["login", "bind_phone", "bind_email", "bind_wechat"].includes(String(value.purpose))) return value as AccountAction;
  if ((value.action === "poll" || value.action === "cancel") && typeof value.flowId === "string" && /^[a-f0-9-]{36}$/u.test(value.flowId)) return value as AccountAction;
  if (value.action === "refresh" || value.action === "logout") return value as AccountAction;
  return accountFail("invalid_request", "账号操作无效。");
}
export function pngDataUri(value: unknown): string {
  if (typeof value !== "string" || value.length > 700_000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) accountFail("invalid_qr", "账号服务未返回有效的小程序码。", 502);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    || bytes.subarray(12, 16).toString("ascii") !== "IHDR" || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 2048
    || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 2048) accountFail("invalid_qr", "账号服务未返回有效的小程序码。", 502);
  return `data:image/png;base64,${value}`;
}
