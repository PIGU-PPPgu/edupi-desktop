export type AccountPurpose = "login" | "bind_phone" | "bind_email" | "bind_wechat";
export type AccountIdentity = {
  kind: "wechat_miniprogram" | "phone" | "email";
  subject: string;
  namespace: string;
  label: string;
  verifiedAt: string;
};
export type EduPiAccount = { id: string; displayName: string; identities: AccountIdentity[] };
export type PublicEduPiAccount = Omit<EduPiAccount, "identities"> & {
  identities: Array<Pick<AccountIdentity, "kind" | "label" | "verifiedAt">>;
};
export type AccountChallenge = {
  flowId: string;
  purpose: AccountPurpose;
  status: "creating" | "pending" | "scanned" | "expired" | "denied";
  qrImage: string | null;
  userCode: string | null;
  expiresAt: string;
  pollAfter: string;
};
export type AccountStatus = {
  configured: boolean;
  serviceOrigin: string | null;
  state: "unconfigured" | "signed_out" | "signed_in" | "expired";
  account: PublicEduPiAccount | null;
  expiresAt: string | null;
  challenge: AccountChallenge | null;
  localDataMode: "local";
};
export type AccountAction =
  | { action: "start"; purpose: AccountPurpose }
  | { action: "poll"; flowId: string }
  | { action: "cancel"; flowId: string }
  | { action: "refresh" }
  | { action: "logout" };
export type AccountReply = { status: AccountStatus; warning?: string };
