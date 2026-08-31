import type { TaskStage, WorkbenchView } from "./edupi-workbench";

export type DesktopControlInput =
  | { action: "navigate"; view: WorkbenchView }
  | { action: "open_task"; taskId: string; stage?: TaskStage }
  | { action: "open_context" }
  | { action: "open_settings" }
  | { action: "set_inspector"; open: boolean }
  | { action: "close_panel" }
  | { action: "show_window" };

const VIEWS = new Set<WorkbenchView>(["chat", "dashboard", "workspace", "teaching", "homeroom", "calendar", "memory", "insights", "growth", "students", "materials", "review", "tasks", "artifacts"]);
const STAGES = new Set<TaskStage>(["brief", "run", "evidence", "artifact", "review"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("不支持的 desktop 控制参数");
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 不能为空`);
  const result = value.trim();
  if (result.length > 240 || !/^[A-Za-z0-9._:-]+$/.test(result)) throw new Error(`${field} 无效`);
  return result;
}

export function validateDesktopCommand(value: unknown): DesktopControlInput {
  const input = record(value);
  if (input.action === "navigate") {
    exactKeys(input, ["action", "view"]);
    if (typeof input.view !== "string" || !VIEWS.has(input.view as WorkbenchView)) throw new Error("不支持的工作台视图");
    return { action: "navigate", view: input.view as WorkbenchView };
  }
  if (input.action === "open_task") {
    exactKeys(input, ["action", "taskId", "stage"]);
    const taskId = identifier(input.taskId, "taskId");
    if (input.stage !== undefined && (typeof input.stage !== "string" || !STAGES.has(input.stage as TaskStage))) throw new Error("不支持的任务阶段");
    return { action: "open_task", taskId, ...(input.stage ? { stage: input.stage as TaskStage } : {}) };
  }
  if (input.action === "open_context" || input.action === "open_settings" || input.action === "close_panel" || input.action === "show_window") {
    exactKeys(input, ["action"]);
    return { action: input.action };
  }
  if (input.action === "set_inspector") {
    exactKeys(input, ["action", "open"]);
    if (typeof input.open !== "boolean") throw new Error("open 必须是布尔值");
    return { action: "set_inspector", open: input.open };
  }
  throw new Error("不支持的 desktop 控制动作");
}
