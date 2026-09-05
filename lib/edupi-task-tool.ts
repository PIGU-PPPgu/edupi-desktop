import crypto from "node:crypto";
import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { issueTaskBoardCommand, taskBoardContentHash } from "./edupi-task-board-command";

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 240, description: "任务标题；备课任务请在标题中明确写备课或教案" }),
  due_date: Type.Optional(Type.String({ description: "截止日期 YYYY-MM-DD；未明确时留空" })),
  note: Type.Optional(Type.String({ maxLength: 1000, description: "教师要求、课程主题、班级和所需产物" })),
}, { additionalProperties: false });

export function createEduPiTaskTool({ projectRoot, issue = issueTaskBoardCommand }: { projectRoot: string; issue?: typeof issueTaskBoardCommand }) {
  return defineTool<typeof parameters, { taskId: string; created: boolean }>({
    name: "edupi_create_task",
    label: "创建 EduPi 任务",
    description: "教师要求建立备课、教学或其他工作任务时使用。通过 Core 正式写入工作区；备课标题会显示在教学页。创建任务不等于已生成教案或课件。不要仅回复已创建，也不要用文件工具另写任务清单。",
    promptSnippet: "edupi_create_task: 正式创建工作区任务，备课任务同步进入教学页",
    parameters,
    executionMode: "sequential",
    execute: async (toolCallId, params: Static<typeof parameters>, signal, _onUpdate, ctx) => {
      if (resolve(ctx.cwd) !== resolve(projectRoot)) throw new Error("请在 EduPi 工作区创建教学任务。");
      signal?.throwIfAborted();
      const title = params.title.trim();
      if (!title) throw new Error("请填写任务标题。");
      const dueDate = params.due_date?.trim() || null;
      if (dueDate) {
        const date = new Date(`${dueDate}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== dueDate) throw new Error("截止日期无效。");
      }
      const taskId = `teacher-task-${crypto.randomUUID()}`;
      const task = { task_id: taskId, title, due_date: dueDate, note: params.note?.trim() || null };
      const branch = ctx.sessionManager.getBranch();
      const message = [...branch].reverse().find((entry) => entry.type === "message" && entry.message.role === "user");
      const sourceId = message?.id || toolCallId;
      await issue({ command_type: "create_task", task, source: { source_id: sourceId, source_kind: "teacher_message", source_hash: taskBoardContentHash(message || task), evidence_ids: [sourceId] } });
      return { content: [{ type: "text", text: `已创建任务：${title}。可在工作区查看；任务内容尚未执行。任务 ID：${taskId}` }], details: { taskId, created: true } };
    },
  });
}
