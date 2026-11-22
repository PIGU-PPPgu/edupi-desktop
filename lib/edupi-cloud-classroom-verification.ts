import { cloudRecord as row, CloudReadbackConflictError, CloudReadbackError } from "./edupi-cloud-verification.ts";
import { computeCloudClassroom, type CloudClassroomRoster, type CloudClassroomReference } from "./edupi-cloud-classroom-compute";
import type { ClassroomDomain, ClassroomInput } from "./edupi-classroom-types";

type Row = Record<string, unknown>;
export type CloudClassroomRead = (operation: string, body?: Row) => Promise<Row>;
export const classroomCanonical = (value: unknown): unknown => Array.isArray(value) ? value.map(classroomCanonical)
  : row(value) ? Object.fromEntries(Object.keys(value as Row).sort().map(key => [key, classroomCanonical((value as Row)[key])])) : value;
export const sameClassroomValue = (left: unknown, right: unknown) =>
  JSON.stringify(classroomCanonical(left)) === JSON.stringify(classroomCanonical(right));
const fail = (): never => { throw new CloudReadbackError(); };

/** Matches the existing Core duty task contract; not a placeholder link. */
export function cloudClassroomDutyTask(record: Row) {
  const input = row(record.input);
  if (!input || record.domain !== "duty" || typeof record.id !== "string") return fail();
  return { task_id: `duty-${record.id}`, title: Array.from(`${input.class_name} ${input.title}`).slice(0, 240).join(""),
    due_date: input.start_date,
    note: `值日方案 ${record.id}。从 ${input.start_date} 起 ${input.days} 天，完整排班及当前工作量见关联方案。` };
}

export async function verifyCloudClassroomWrite(
  body: Row, result: Row, workspaceId: string, read: CloudClassroomRead,
): Promise<void> {
  const saved = row(result.record), computed = row(body.computed);
  if (result.ok !== true || result.operation !== "classroom" || result.request_id !== body.request_id
    || result.action !== body.action || result.workspace_id !== workspaceId || result.external_send !== false
    || typeof result.replayed !== "boolean" || !["save", "restore", "publish"].includes(String(body.action))
    || !saved || saved.id !== body.id || saved.domain !== body.domain || !Number.isSafeInteger(saved.revision)
    || Number(saved.revision) !== Number(body.expected_revision) + 1 || !computed || !row(computed.result)
    || !sameClassroomValue(saved.input, computed.input) || !sameClassroomValue(saved.result, computed.result)
    || !sameClassroomValue(saved.issues, computed.issues)) return fail();
  // Independently run the real host engine before acknowledging the outbox.
  // Matching a caller-supplied result or an empty placeholder is insufficient.
  try {
    const rebuilt = await computeCloudClassroom(body.domain as ClassroomDomain, computed.source_input as ClassroomInput,
      computed.roster as CloudClassroomRoster[], computed.references as CloudClassroomReference[]);
    if (rebuilt.core_commit !== computed.core_commit || !sameClassroomValue(rebuilt.input, computed.input)
      || !sameClassroomValue(rebuilt.result, computed.result) || !sameClassroomValue(rebuilt.issues, computed.issues)) return fail();
  } catch { return fail(); }
  const versions = Array.isArray(saved.versions) ? saved.versions.map(row) : [];
  const version = versions.at(-1);
  if (!version || version.revision !== saved.revision || version.action !== body.action
    || version.restored_from !== (body.action === "restore" ? body.revision : null)) return fail();
  if (body.action === "restore") {
    const historical = await read("classroom", { domain: body.domain, action: "read", id: body.id, revision: body.revision,
      request_id: `${body.request_id}-version` });
    const original = row(historical.record);
    if (historical.workspace_id !== workspaceId || !original || original.revision !== body.revision
      || !sameClassroomValue(original.input, saved.input) || !sameClassroomValue(original.result, saved.result)) return fail();
  }
  const response = await read("classroom", { domain: body.domain, action: "read", id: body.id, request_id: `${body.request_id}-readback` });
  const current = row(response.record);
  if (response.ok !== true || response.operation !== "classroom" || response.external_send !== false
    || response.workspace_id !== workspaceId || !current) return fail();
  if (!sameClassroomValue(current, saved)) throw new CloudReadbackConflictError();
  if (body.action === "publish") {
    const expected = cloudClassroomDutyTask(saved), publication = row(saved.publication), task = row(result.task);
    if (!publication || publication.state !== "linked" || publication.source_revision !== body.expected_revision
      || publication.task_id !== expected.task_id || saved.task_id !== expected.task_id || !task
      || !sameClassroomValue(response.task, task)) return fail();
    const dashboard = await read("mobile-dashboard");
    const payload = row(dashboard.payload);
    const matches = Array.isArray(payload?.tasks) ? payload.tasks.map(row).filter(item => item?.task_id === expected.task_id) : [];
    const actual = matches[0];
    if (dashboard.external_send !== false || payload?.workspace_id !== workspaceId || matches.length !== 1 || !actual
      || Object.entries(expected).some(([key, value]) => actual[key] !== value || task[key] !== value)
      || actual.stage !== task.stage || actual.status !== task.status || actual.revision !== task.revision) return fail();
  }
}
