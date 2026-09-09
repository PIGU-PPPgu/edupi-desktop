import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { preparationArtifactRequest } from "./edupi-preparation-artifact-server";

export function createPreparationArtifactTool(projectRoot: string, request = preparationArtifactRequest) {
  return defineTool({ name: "edupi_preparation_artifact", label: "修订教学产物", executionMode: "sequential", description: "按产物ID读取正文或历史版本，并通过Core版本校验保存修订。先read当前版本，再revise完整正文；禁止用bash/write直接覆盖产物文件。修订后仍为待教师审核候选。", parameters: Type.Object({ action: Type.Union([Type.Literal("read"), Type.Literal("revise")]), artifact_id: Type.String({ minLength: 1, maxLength: 160 }), revision: Type.Optional(Type.Integer({ minimum: 1 })), expected_revision: Type.Optional(Type.Integer({ minimum: 1 })), content: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })) }, { additionalProperties: false }), execute: async (_id, input, signal, _update, ctx) => {
    if (path.resolve(ctx.cwd) !== path.resolve(projectRoot)) throw new Error("请在产物所属工作区操作");
    if (input.action === "read") { const result = await request("read", { artifact_id: input.artifact_id, ...(input.revision === undefined ? {} : { revision: input.revision }) }, signal); return { content: [{ type: "text", text: JSON.stringify(result.artifact) }], details: result }; }
    if (!input.expected_revision || !input.content?.trim() || Buffer.byteLength(input.content) > 100000) throw new Error("修订需要当前版本和完整正文");
    const message = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
    if (!message || message.type !== "message" || message.message.role !== "user") throw new Error("没有可关联的教师消息");
    const content = message.message.content;
    const text = typeof content === "string" ? content : content.filter(block => block.type === "text").map(block => block.text).join("\n");
    const result = await request("revise", { artifact_id: input.artifact_id, expected_revision: input.expected_revision, content: input.content, actor: "agent", source: { session_id: ctx.sessionManager.getSessionId(), message_id: message.id, tool_call_id: _id, text } }, signal);
    return { content: [{ type: "text", text: `已保存候选版本 ${result.artifact.revision}，待教师审核。` }], details: result };
  } });
}
