import { resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readEducationContract } from "./edupi-education-server";
import { issueEntityDelete } from "./edupi-entity-delete";

const parameters = Type.Object({
  category: Type.Union([Type.Literal("semester"), Type.Literal("class"), Type.Literal("teaching"), Type.Literal("preferences"), Type.Literal("school")]),
  query: Type.String({ minLength: 1, maxLength: 4000 }),
});
export function createMemoryForgetTool(projectRoot: string, { read = readEducationContract, remove = issueEntityDelete }: { read?: typeof readEducationContract; remove?: typeof issueEntityDelete } = {}) {
  return defineTool({
    name: "memory_forget", label: "删除记忆", parameters, executionMode: "sequential",
    description: "教师明确要求删除记忆时，按类别和内容或标签关键词删除匹配记录。使用桌面相同的删除流程，保留原始记录。",
    execute: async (_callId, params, signal, _update, ctx) => {
      if (resolve(ctx.cwd) !== resolve(projectRoot)) throw new Error("请在 EduPi 工作区删除记忆");
      signal?.throwIfAborted();
      const query = params.query.trim().toLowerCase();
      if (!query) throw new Error("请指定要删除的记忆");
      const matches = (await read()).continuity.memories.filter(item => item.category === params.category && item.state === "active" && (item.content.toLowerCase().includes(query) || item.tags.some(tag => tag.toLowerCase().includes(query))));
      let removed = 0;
      try {
        for (const item of matches) {
          signal?.throwIfAborted();
          await remove({ kind: "memory", id: item.id, note: "教师通过对话删除", signal });
          removed++;
        }
      } catch { throw new Error(`已删除 ${removed} 条，其余未完成，请重试`); }
      return { content: [{ type: "text", text: removed ? `已删除 ${removed} 条记忆。` : "没有找到匹配的记忆。" }], details: { removed } };
    },
  });
}
