import { createHash, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

const DEFAULT_INVITE_DIGEST = "1239a2473fe77264053be2cfa3a6fa10b2f5534be043db5989ca3483b73b6593";
const REGISTRATION_SCHEMA_VERSION = 1;

export type EduPiRegistrationState =
  | { registered: false; registeredAt: null }
  | { registered: true; registeredAt: string };

export type EduPiRegistrationErrorCode =
  | "invalid_invite"
  | "validator_unavailable"
  | "corrupt_state";

export class EduPiRegistrationError extends Error {
  constructor(
    public readonly code: EduPiRegistrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EduPiRegistrationError";
  }
}

export function edupiRegistrationFile(
  configured = process.env.EDUPI_REGISTRATION_FILE,
): string {
  if (configured?.trim()) {
    const result = configured.trim();
    if (!isAbsolute(result)) {
      throw new EduPiRegistrationError("corrupt_state", "注册状态路径必须是绝对路径。");
    }
    return result;
  }
  return join(getAgentDir(), "edupi-desktop", "registration.json");
}

function parseStoredRegistration(value: unknown): EduPiRegistrationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EduPiRegistrationError("corrupt_state", "本机注册状态无效。");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2
    || record.schema_version !== REGISTRATION_SCHEMA_VERSION
    || typeof record.registered_at !== "string"
    || record.registered_at.length > 64
    || !Number.isFinite(Date.parse(record.registered_at))
  ) {
    throw new EduPiRegistrationError("corrupt_state", "本机注册状态无效。");
  }
  return { registered: true, registeredAt: record.registered_at };
}

export function readEduPiRegistration(
  path = edupiRegistrationFile(),
): EduPiRegistrationState {
  try {
    return parseStoredRegistration(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { registered: false, registeredAt: null };
    }
    if (error instanceof EduPiRegistrationError) throw error;
    throw new EduPiRegistrationError("corrupt_state", "本机注册状态无效。");
  }
}

function expectedInviteDigest(): Buffer {
  const configured = (process.env.EDUPI_INVITE_CODE_SHA256 || DEFAULT_INVITE_DIGEST).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(configured)) {
    throw new EduPiRegistrationError("validator_unavailable", "邀请码校验暂不可用。");
  }
  return Buffer.from(configured, "hex");
}

function inviteMatches(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim() || value.length > 128) return false;
  const received = createHash("sha256").update(value.trim()).digest();
  return timingSafeEqual(received, expectedInviteDigest());
}

export function registerEduPi(
  inviteCode: unknown,
  options: { path?: string; now?: Date } = {},
): EduPiRegistrationState {
  const path = options.path ?? edupiRegistrationFile();
  const current = readEduPiRegistration(path);
  if (current.registered) return current;
  if (!inviteMatches(inviteCode)) {
    throw new EduPiRegistrationError("invalid_invite", "邀请码不正确。");
  }

  const registeredAt = (options.now ?? new Date()).toISOString();
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  writePrivateFileAtomicSync(path, `${JSON.stringify({
    schema_version: REGISTRATION_SCHEMA_VERSION,
    registered_at: registeredAt,
  }, null, 2)}\n`);
  chmodSync(path, 0o600);
  return { registered: true, registeredAt };
}
