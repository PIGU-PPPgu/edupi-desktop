import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";

const parameters = Type.Object({
  category: Type.Union([Type.Literal("semester"), Type.Literal("teaching"), Type.Literal("preferences"), Type.Literal("school")]),
  content: Type.String({ minLength: 1, maxLength: 4000 }),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 50 })),
  student: Type.Optional(Type.String({ maxLength: 160 })),
  date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  importance: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
  supersedes: Type.Optional(Type.String({ maxLength: 4000 })),
});
type Write = { source: { session_id: string; message_id: string; tool_call_id: string; text: string }; input: Static<typeof parameters> & { tags: string[] } };
type Result = { ok: boolean; code?: string; id?: string; count?: number; merged?: boolean; replayed?: boolean };
async function persist(value: Write, signal?: AbortSignal): Promise<Result> {
  return runCoreProcess<Result>({ ...resolveEduPiBridgeRoots(), signal, timeoutMs: 15000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: randomUUID(), operation: "memory-write", action: "write", ...value } });
}

export function createMemoryWriteTool(projectRoot: string, write: typeof persist = persist) {
  return defineTool({
    name: "memory_write", label: "写入记忆", parameters, executionMode: "sequential",
    description: "保存老师明确表达的学期安排、教学记录、偏好或学校信息。tags用于检索，supersedes指定被取代的旧内容。学生学习表现与同伴互动使用edupi_student_records，先获取学生ID。",
    promptGuidelines: ["只保存教师明确提供的信息，不把建议、假设或引用当成已发生事实。"],
    promptSnippet: "memory_write: 将教师明确的信息保存到教育记忆，只有保存成功才告知已记住",
    execute: async (callId, params, signal, _update, ctx) => {
      if (resolve(ctx.cwd) !== resolve(projectRoot)) throw new Error("请在 EduPi 工作区保存记忆");
      signal?.throwIfAborted();
      const message = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
      if (!message || message.type !== "message" || message.message.role !== "user") throw new Error("没有可关联的教师消息");
      const content = message.message.content;
      const text = typeof content === "string" ? content : content.filter(block => block.type === "text").map(block => block.text).join("\n");
      const result = await write({ source: { session_id: ctx.sessionManager.getSessionId(), message_id: message.id, tool_call_id: callId, text }, input: { ...params, tags: params.tags || [] } }, signal);
      if (!result.ok) throw new Error(result.code === "source_conflict" ? "这条消息的记忆内容已变化，未保存" : "记忆未保存，请重试");
      return { content: [{ type: "text", text: result.replayed ? "已记录过，未重复保存。" : result.merged ? "记忆已更新。" : "已记住。" }], details: result };
    },
  });
}
