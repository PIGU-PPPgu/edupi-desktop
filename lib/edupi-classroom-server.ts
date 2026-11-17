import { createHash, randomUUID } from "node:crypto";
import { resolveEduPiBridgeRoots, readEduPiEducationSnapshot } from "./edupi-core-snapshot";
import { runCoreProcess } from "./edupi-core-process-client";
import { ensureEduPiRuntime } from "./edupi-runtime-supervisor";
import { issueTaskBoardCommand, taskBoardContentHash } from "./edupi-task-board-command";
import type { ClassroomRecord, ClassroomReply, ClassroomRequest, DutyInput } from "./edupi-classroom-types";

export class ClassroomError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function core(request: Omit<ClassroomRequest, "action"> & { action: string; task_id?: string }, signal?: AbortSignal): Promise<ClassroomReply> {
  const roots = resolveEduPiBridgeRoots();
  await ensureEduPiRuntime(roots);
  const durableId = ["save", "restore", "begin_publish"].includes(request.action)
    ? `classroom-${createHash("sha256").update(JSON.stringify(request)).digest("hex")}` : `classroom-${randomUUID()}`;
  const requestId = request.request_id || durableId;
  const response = await runCoreProcess<ClassroomReply & { code?: string; message?: string }>({
    ...roots, timeoutMs: 15_000, signal,
    request: { ...request, request_id: requestId, operation: "classroom", protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop" },
  });
  if (response.operation !== "classroom" || response.request_id !== requestId || response.external_send !== false) throw new ClassroomError("invalid_response", "Core 返回的方案身份无效。");
  if (!response.ok) throw new ClassroomError(response.code || "unavailable", response.message || "班级功能暂不可用。");
  return response;
}

/** The UI and agent tool share computation, writes, readback and task publication. */
export async function classroomService(request: ClassroomRequest, signal?: AbortSignal): Promise<ClassroomReply> {
  if (request.action === "publish") {
    const current = await core({ domain: "duty", action: "read", id: request.id }, signal);
    let record = current.record;
    if (!record || record.revision !== request.expected_revision && record.publication?.source_revision !== request.expected_revision) throw new ClassroomError("stale_revision", "排班已更新，请重新打开。");
    if (record.task_id) return current;
    const reservation = await core({ domain: "duty", action: "begin_publish", id: record.id, expected_revision: record.revision }, signal);
    if (!reservation.record) throw new ClassroomError("invalid_response", "Core 未返回任务关联状态。");
    record = reservation.record;
    const input = record.input as DutyInput;
    const taskId = `duty-${record.id}`;
    const title = `${input.class_name} ${input.title}`.slice(0, 240);
    const note = `值日方案 ${record.id}。从 ${input.start_date} 起 ${input.days} 天，完整排班及当前工作量见关联方案。`;
    const snapshot = await readEduPiEducationSnapshot();
    const rawTasks = snapshot.payload.education_workspace.tasks;
    const tasks: Array<Record<string, unknown>> = Array.isArray(rawTasks) ? rawTasks.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object" && !Array.isArray(task)) : [];
    const existing = tasks.find(task => task.task_id === taskId);
    if (existing && (existing.title !== title || existing.due_date !== input.start_date)) throw new ClassroomError("task_conflict", "关联任务与排班身份不符，请核对。");
    if (!existing) {
      await issueTaskBoardCommand({
        command_type: "create_task",
        source: { source_id: record.id, source_kind: "teacher_message", source_hash: taskBoardContentHash(record), evidence_ids: [record.id] },
        task: { task_id: taskId, title, due_date: input.start_date, note },
      });
    }
    signal?.throwIfAborted();
    return core({ domain: "duty", action: "link_task", id: record.id, expected_revision: record.revision, task_id: taskId,
      request_id: `classroom-link-${record.id}-${record.publication?.source_revision}` }, signal);
  }
  const response = await core(request, signal);
  if (["save", "restore"].includes(request.action)) {
    const saved = response.record;
    if (!saved) throw new ClassroomError("invalid_response", "Core 未返回保存结果。");
    const readback = await core({ domain: request.domain, action: "read", id: saved.id }, signal);
    if (readback.record && readback.record.revision > saved.revision) {
      throw new ClassroomError("readback_advanced", `操作已保存为版本 ${saved.revision}，方案当前为版本 ${readback.record.revision}，请重新打开。`);
    }
    if (!readback.record || readback.record.revision !== saved.revision
      || JSON.stringify(readback.record.input) !== JSON.stringify(saved.input)
      || JSON.stringify(readback.record.result) !== JSON.stringify(saved.result)) {
      throw new ClassroomError("readback_failed", "保存后回读不一致，请重新打开核对。");
    }
    return readback;
  }
  return response;
}

export function classroomRecordSummary(record: ClassroomRecord): string {
  return `${record.input.title}，版本 ${record.revision}，ID ${record.id}`;
}
