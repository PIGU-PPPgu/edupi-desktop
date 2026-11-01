import type { AgentMessage, AssistantMessage, ToolCallContent, ToolResultMessage } from "./types";
import type { PublicDynamicWorkflowRun } from "./edupi-dynamic-workflow";

export type WorkflowStepStatus = "pending" | "running" | "done" | "failed" | "interrupted" | "skipped";
export type WorkflowStep = { id: string; name: string; toolName: string; status: WorkflowStepStatus };
export type WorkflowPhase = { id: string; name: string; status: WorkflowStepStatus; steps: WorkflowStep[] };
export type WorkflowView = {
  title: string;
  managed: boolean;
  phases: WorkflowPhase[];
  completed: number;
  total: number;
  hiddenPhases: number;
  hiddenSteps: number;
  status: WorkflowStepStatus;
};

export function projectManagedWorkflow(run: PublicDynamicWorkflowRun): WorkflowView {
  const phases = run.phases.map(phase => ({ id: phase.id,
    name: phase.visits > 1 ? `${phase.name} · 第 ${phase.visits} 轮` : phase.name, status: phase.status,
    steps: phase.agents.map(agent => ({ id: agent.id, name: agent.name, toolName: "独立子任务", status: agent.status })) }));
  return { title: run.title, managed: true, phases,
    completed: phases.reduce((count, phase) => count + phase.steps.filter(step => step.status === "done").length, 0),
    total: phases.reduce((count, phase) => count + phase.steps.length, 0),
    hiddenPhases: 0, hiddenSteps: 0, status: run.status };
}

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

  const phases: WorkflowPhase[] = [];
  let phaseCount = 0;
  let total = 0;
  let completed = 0;
  let hasFailure = false;
  let hasInterruption = false;
  for (let index = promptIndex + 1; index < messages.length; index++) {
    const calls = toolCalls(messages[index]);
    if (!calls.length) continue;
    phaseCount++;
    const steps: WorkflowStep[] = [];
    let phaseRunning = false, phaseFailed = false, phaseInterrupted = false;
    for (const call of calls) {
      const result = results.get(call.toolCallId);
      const status: WorkflowStepStatus = result ? result.isError ? "failed" : "done" : busy ? "running" : "interrupted";
      total++;
      if (status === "done") completed++;
      if (status === "failed") hasFailure = true;
      if (status === "interrupted") hasInterruption = true;
      if (status === "running") phaseRunning = true;
      if (status === "failed") phaseFailed = true;
      if (status === "interrupted") phaseInterrupted = true;
      steps.push({ id: call.toolCallId, name: workflowToolName(call.toolName), toolName: call.toolName, status });
      if (steps.length > MAX_STEPS) steps.shift();
    }
    phases.push({ id: `wave-${index}`, name: calls.length === 1 ? steps[0].name : `${calls.length} 项操作`,
      status: phaseRunning ? "running" : phaseFailed ? "failed" : phaseInterrupted ? "interrupted" : "done", steps });
    if (phases.length > MAX_PHASES) phases.shift();
  }

  if (busy && activeTools.length && !phases.some(phase => phase.steps.some(step => step.status === "running"))) {
    const steps = activeTools.slice(0, 8).map((name, index) => ({ id: `live-${index}`, name: workflowToolName(name),
      toolName: name, status: "running" as const }));
    total += steps.length;
    phaseCount++;
    phases.push({ id: "live", name: steps.length === 1 ? steps[0].name : `${steps.length} 项操作`, status: "running", steps });
    if (phases.length > MAX_PHASES) phases.shift();
  }
  if (!phaseCount) return null;
  let displayed = phases.reduce((count, phase) => count + phase.steps.length, 0);
  while (displayed > MAX_STEPS) {
    const first = phases[0];
    const remove = Math.min(displayed - MAX_STEPS, first.steps.length);
    first.steps = first.steps.slice(remove);
    displayed -= remove;
    if (!first.steps.length) phases.shift();
  }
  const status: WorkflowStepStatus = busy ? "running" : hasFailure ? "failed" : hasInterruption ? "interrupted" : "done";
  return { title: "执行流程", managed: false, phases, completed, total,
    hiddenPhases: phaseCount - phases.length, hiddenSteps: total - displayed, status };
}
