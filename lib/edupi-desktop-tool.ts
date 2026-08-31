import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool, type AgentToolResult, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { validateDesktopCommand, type DesktopControlInput } from "./edupi-desktop-control";

const parameters = Type.Object({
  action: Type.Union([
    Type.Literal("navigate"),
    Type.Literal("open_task"),
    Type.Literal("open_context"),
    Type.Literal("open_settings"),
    Type.Literal("set_inspector"),
    Type.Literal("close_panel"),
    Type.Literal("show_window"),
  ]),
  view: Type.Optional(Type.String()),
  task_id: Type.Optional(Type.String()),
  stage: Type.Optional(Type.String()),
  open: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

type ToolParameters = Static<typeof parameters>;

type ToolOptions = {
  projectRoot: string;
  requestAction: (action: DesktopControlInput, signal?: AbortSignal) => Promise<boolean>;
};

function textResult(text: string, action: DesktopControlInput): AgentToolResult<{ action: DesktopControlInput }> {
  return { content: [{ type: "text", text }], details: { action } };
}

function actionLabel(action: DesktopControlInput): string {
  if (action.action === "navigate") return `已打开 ${action.view}`;
  if (action.action === "open_task") return `已打开教学任务 ${action.taskId}`;
  if (action.action === "open_context") return "已打开教学上下文";
  if (action.action === "open_settings") return "已打开应用设置";
  if (action.action === "set_inspector") return action.open ? "已打开任务检查" : "已收起任务检查";
  if (action.action === "show_window") return "已显示 EduPi 窗口";
  return "已关闭当前面板";
}

export function createEduPiAppControlTool(options: ToolOptions) {
  const projectRoot = resolve(options.projectRoot);
  return defineTool<typeof parameters, { action: DesktopControlInput }>({
    name: "edupi_app_control",
    label: "控制 EduPi 应用",
    description: "控制当前 EduPi 应用自身的界面。只允许打开工作台视图、教学任务、上下文、设置、检查面板或显示窗口；不能执行任意点击、脚本、审核、写入或外发。",
    promptSnippet: "edupi_app_control: 打开 EduPi 内的视图或教学任务",
    promptGuidelines: [
      "需要把教师带到 EduPi 的某个页面或任务时才使用",
      "此工具不能代替教师做审核、写入事实或对外发送",
    ],
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId: string, params: ToolParameters, signal: AbortSignal | undefined, _onUpdate, ctx: ExtensionContext) => {
      if (resolve(ctx.cwd) !== projectRoot) throw new Error("仅允许 EduPi 工作区中的 Agent 控制 EduPi 应用。");
      let action: DesktopControlInput;
      try {
        action = validateDesktopCommand({
          action: params.action,
          ...(params.view !== undefined ? { view: params.view } : {}),
          ...(params.task_id !== undefined ? { taskId: params.task_id } : {}),
          ...(params.stage !== undefined ? { stage: params.stage } : {}),
          ...(params.open !== undefined ? { open: params.open } : {}),
        });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      const confirmed = await options.requestAction(action, signal);
      if (!confirmed) throw new Error("EduPi 应用未确认该操作；窗口可能未连接或请求已超时。");
      return textResult(actionLabel(action), action);
    },
  });
}
