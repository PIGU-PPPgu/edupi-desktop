import { taskBoardContentHash, type TaskBoardCommand } from "./edupi-task-board-command";
import { createEduPiCloudClient, type CloudScope } from "./edupi-cloud-client";
import { readCloudEducationWorkspaceBundle } from "./edupi-cloud-education";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function issueCloudTaskBoardCommand(command: TaskBoardCommand, options: {
  requestId?: string;
  idempotencyKey?: string;
  scope?: CloudScope;
} = {}) {
  if (!options.requestId || !options.idempotencyKey) throw new Error("云端任务命令缺少固定请求身份");
  const client = createEduPiCloudClient();
  const scope = options.scope || await client.captureScope();
  const queued = await client.taskCommand(command, {
    requestId: options.requestId,
    idempotencyKey: options.idempotencyKey,
  }, scope);
  if (queued.queued) {
    return { queued: true as const, queueEntry: queued.entry };
  }
  const response = queued.result;
  if (response.ok !== true || response.operation !== "command"
    || response.request_id !== options.requestId || response.external_send !== false) {
    throw new Error("云端任务命令回执无效");
  }
  const receipt = record(response.receipt);
  const payload = record(receipt?.payload);
  const taskId = command.command_type === "create_task" ? command.task.task_id : command.task_id;
  const target = record(payload?.target);
  if (!payload || target?.target_kind !== "task" || target.target_id !== taskId
    || payload.external_send !== false) {
    throw new Error("云端任务回执未绑定到目标任务");
  }
  const data = (await readCloudEducationWorkspaceBundle(client, scope)).data;
  const task = data.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("云端任务写入后无法重新读取");
  return { queued: false as const, response, receipt: payload, replayed: response.replayed === true, task, data };
}

export function cloudTaskSource(command: TaskBoardCommand): string {
  return taskBoardContentHash(command);
}
