import crypto from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const MUTATING_TOOL_NAMES = new Set([
  "calendar_add",
  "calendar_import",
  "calendar_remove",
  "timetable_import",
  "memory_write",
  "memory_forget",
  "edupi_student_records",
  "edupi_create_task",
  "edupi_update_task",
  "edupi_prepare_task",
  "edupi_preparation_artifact",
  "edupi_make_document",
  "edupi_make_ppt",
]);

type RawRecord = Record<string, unknown>;
type GuardContext = { sessionManager: { getBranch: () => readonly unknown[] } };

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = record(value);
  return source ? Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])])) : value;
}

function argsHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)) ?? "undefined").digest("hex");
}

function currentUserId(ctx: GuardContext): string {
  const user = [...ctx.sessionManager.getBranch()].reverse().map(record).find((entry) => entry?.type === "message"
    && record(entry.message)?.role === "user");
  return typeof user?.id === "string" ? user.id : "no-user-entry";
}

export function isEduPiMutationToolName(toolName: unknown): boolean {
  return typeof toolName === "string" && MUTATING_TOOL_NAMES.has(toolName);
}

export function createEduPiMutationGuard(): ExtensionFactory {
  return (pi) => {
    const attempted = new Map<string, Set<string>>();
    const failed = new Set<string>();

    pi.on("tool_call", (event, ctx) => {
      if (!isEduPiMutationToolName(event.toolName)) return;
      const userId = currentUserId(ctx);
      const toolKey = `${userId}:${event.toolName}`;
      const callKey = `${toolKey}:${argsHash(event.input)}`;
      const calls = attempted.get(toolKey) ?? new Set<string>();
      attempted.set(toolKey, calls);
      if (failed.has(toolKey)) {
        return {
          block: true,
          terminate: true,
          reason: "这次写入已经失败，已停止自动重试。请稍后重新发送明确请求。",
        };
      }
      if (calls.has(callKey)) {
        return {
          block: true,
          terminate: true,
          reason: "本条教师请求已经执行过相同写入，已停止重复操作。",
        };
      }
      calls.add(callKey);
    });

    pi.on("tool_result", (event, ctx) => {
      if (!isEduPiMutationToolName(event.toolName)) return;
      if (event.isError === true || record(event.details)?.ok === false) {
        failed.add(`${currentUserId(ctx)}:${event.toolName}`);
      }
    });
  };
}
