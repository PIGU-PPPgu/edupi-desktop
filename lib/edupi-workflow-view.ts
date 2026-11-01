import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";

export type WorkflowStepStatus = "running" | "done" | "failed" | "interrupted";
export type WorkflowStep = { id: string; name: string; toolName: string; status: WorkflowStepStatus };
export type WorkflowPhase = { id: string; name: string; status: WorkflowStepStatus; steps: WorkflowStep[] };
export type WorkflowView = {
  phases: WorkflowPhase[];
  completed: number;
  total: number;
  hiddenPhases: number;
  status: WorkflowStepStatus;
};

const MAX_PHASES = 12;
const MAX_STEPS = 48;
const TOOL_NAMES: Record<string, string> = {
  read: "读取", find: "查找", grep: "检索", ls: "浏览文件", bash: "运行命令",
  edit: "修改文件", write: "写入文件", edupi_make_document: "生成文档",
  edupi_make_ppt: "生成课件", edupi_create_task: "创建任务", edupi_update_task: "更新任务",
  edupi_prepare_task: "课前准备", memory_recall: "查阅记忆", memory_write: "记录记忆",
};

export function workflowToolName(name: string): string {
  return TOOL_NAMES[name] ?? name.replace(/^edupi_/u, "").replaceAll("_", " ").slice(0, 48);
}

function toolCalls(message: AgentMessage): ToolCallContent[] {
  if (message.role !== "assistant") return [];
  return (message as AssistantMessage).content.filter((block): block is ToolCallContent => block.type === "toolCall"
    && typeof block.toolCallId === "string" && Boolean(block.toolCallId)
    && typeof block.toolName === "string" && Boolean(block.toolName));
}

function phaseStatus(steps: WorkflowStep[]): WorkflowStepStatus {
  if (steps.some(step => step.status === "running")) return "running";
  if (steps.some(step => step.status === "failed")) return "failed";
  if (steps.some(step => step.status === "interrupted")) return "interrupted";
  return "done";
}

/** One station per observed Pi tool batch. No inferred agents, success or parallelism. */
export function projectWorkflowView(messages: readonly AgentMessage[], busy: boolean, activeTools: readonly string[] = []): WorkflowView | null {
  let promptIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") { promptIndex = index; break; }
  }
  if (promptIndex < 0) return null;

  const results = new Map<string, ToolResultMessage>();
  for (let index = promptIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "toolResult" && typeof message.toolCallId === "string") results.set(message.toolCallId, message);
  }

  const all: WorkflowPhase[] = [];
  let remaining = MAX_STEPS;
  for (let index = promptIndex + 1; index < messages.length && remaining > 0; index++) {
    const calls = toolCalls(messages[index]).slice(0, remaining);
    if (!calls.length) continue;
    remaining -= calls.length;
    const steps = calls.map((call) => {
      const result = results.get(call.toolCallId);
      return { id: call.toolCallId, name: workflowToolName(call.toolName), toolName: call.toolName,
        status: result ? result.isError ? "failed" as const : "done" as const : busy ? "running" as const : "interrupted" as const };
    });
    all.push({ id: `wave-${index}`, name: steps.length === 1 ? steps[0].name : `${steps.length} 项操作`,
      status: phaseStatus(steps), steps });
  }

  if (busy && activeTools.length && !all.some(phase => phase.steps.some(step => step.status === "running"))) {
    const steps = activeTools.slice(0, 8).map((name, index) => ({ id: `live-${index}`, name: workflowToolName(name),
      toolName: name, status: "running" as const }));
    all.push({ id: "live", name: steps.length === 1 ? steps[0].name : `${steps.length} 项操作`, status: "running", steps });
  }
  if (!all.length) return null;
  const phases = all.slice(-MAX_PHASES);
  const completed = all.reduce((count, phase) => count + phase.steps.filter(step => step.status === "done").length, 0);
  const total = all.reduce((count, phase) => count + phase.steps.length, 0);
  const status: WorkflowStepStatus = busy ? "running" : all.some(phase => phase.status === "failed") ? "failed"
    : all.some(phase => phase.status === "interrupted") ? "interrupted" : "done";
  return { phases, completed, total, hiddenPhases: all.length - phases.length, status };
}
