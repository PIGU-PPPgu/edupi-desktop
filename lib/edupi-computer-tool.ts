import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool, type AgentToolResult, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  COMPUTER_USE_ACTIONS,
  computerActionNeedsApproval,
  validateComputerUseInput,
  type ComputerUseBridgeResult,
  type ComputerUseInput,
} from "./edupi-computer-use";

const parameters = Type.Object({
  action: Type.Union(COMPUTER_USE_ACTIONS.map((action) => Type.Literal(action))),
  snapshot_id: Type.Optional(Type.String()),
  ref: Type.Optional(Type.Integer()),
  text: Type.Optional(Type.String()),
  target: Type.Optional(Type.String()),
  app: Type.Optional(Type.String()),
  x: Type.Optional(Type.Integer()),
  y: Type.Optional(Type.Integer()),
  start_x: Type.Optional(Type.Integer()),
  start_y: Type.Optional(Type.Integer()),
  end_x: Type.Optional(Type.Integer()),
  end_y: Type.Optional(Type.Integer()),
  key: Type.Optional(Type.String()),
  direction: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")])),
  amount: Type.Optional(Type.Integer()),
  display: Type.Optional(Type.Integer()),
  window_id: Type.Optional(Type.Integer()),
  seconds: Type.Optional(Type.Number()),
}, { additionalProperties: false });

type ToolParameters = Static<typeof parameters>;

type ToolOptions = {
  projectRoot: string;
  requestAction: (action: ComputerUseInput, signal?: AbortSignal) => Promise<ComputerUseBridgeResult>;
};

type ToolDetails = {
  action: ComputerUseInput["action"];
  operationId: string;
  snapshotId: string | null;
};

function toolResult(result: Extract<ComputerUseBridgeResult, { ok: true }>, input: ComputerUseInput): AgentToolResult<ToolDetails> {
  return {
    content: [
      { type: "text", text: result.result.content },
      ...result.result.images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mediaType })),
    ],
    details: {
      action: input.action,
      operationId: result.result.operationId,
      snapshotId: result.result.snapshotId,
    },
  };
}

export function createEduPiComputerUseTool(options: ToolOptions) {
  const projectRoot = resolve(options.projectRoot);
  return defineTool<typeof parameters, ToolDetails>({
    name: "edupi_computer_use",
    label: "控制本机桌面",
    description: "在教师明确授权后读取并控制本机桌面。先用 status 检查开关，再用 observe 获取无障碍元素、屏幕画面和 snapshot_id。任何点击、输入、按键、滚动或窗口操作都必须携带最新 snapshot_id；每次操作后快照立即失效，必须重新 observe。支持 NomiFun Computer Use 的无障碍元素、截图、鼠标、键盘、滚动、窗口、应用/文件启动和等待动作。",
    promptSnippet: "edupi_computer_use: 经教师确认后观察或控制本机桌面",
    promptGuidelines: [
      "桌面控制默认关闭；先调用 status，若关闭请让教师在应用设置中开启",
      "优先 observe + 元素 ref，不要猜像素坐标",
      "除 status 和 wait 外每次调用都会要求教师确认",
      "每次改变桌面后必须重新 observe，并使用新的 snapshot_id",
      "不得用 launch 打开网页；网页交互使用受管理的浏览器工具",
    ],
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId: string, raw: ToolParameters, signal: AbortSignal | undefined, _onUpdate, ctx: ExtensionContext) => {
      if (resolve(ctx.cwd) !== projectRoot) throw new Error("仅允许 EduPi 工作区中的 Agent 使用本机桌面控制。");
      const input = validateComputerUseInput(raw);
      if (computerActionNeedsApproval(input.action) && !ctx.hasUI) throw new Error("本机桌面控制需要可见的 EduPi 确认界面。");
      const result = await options.requestAction(input, signal);
      if (!result.ok) throw new Error(result.error);
      if (result.result.isError) throw new Error(result.result.content);
      return toolResult(result, input);
    },
  });
}
