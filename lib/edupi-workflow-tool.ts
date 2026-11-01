import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { executeDynamicWorkflow, makeDynamicWorkflowRun, validateDynamicWorkflowPlan, workflowChildSessionDir } from "./edupi-dynamic-workflow";

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 80 }),
  phases: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 60 }),
    agents: Type.Array(Type.Object({
      name: Type.String({ minLength: 1, maxLength: 48 }),
      task: Type.String({ minLength: 1, maxLength: 500 }),
    }, { additionalProperties: false }), { minItems: 1, maxItems: 4 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 6 }),
}, { additionalProperties: false });

type Parameters = Static<typeof parameters>;

function assistantText(sessionFile: string): string {
  if (!sessionFile) return "";
  const manager = SessionManager.open(sessionFile);
  const final = [...manager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "assistant");
  if (final?.type !== "message" || final.message.role !== "assistant") return "";
  if (final.message.stopReason === "error" || final.message.stopReason === "aborted" || final.message.errorMessage) return "";
  return final.message.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
}

type Agent = { name: string; task: string };
type ChildModel = { provider: string; modelId: string };

async function runReadOnlyAgent(agent: Agent, previous: string, cwd: string, model: ChildModel | undefined,
  thinkingLevel: ThinkingLevel | undefined, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { startHarnessSession } = await import("./harness/runtime");
  const { session } = await startHarnessSession(`workflow-${randomUUID()}`, "", cwd, {
    toolNames: ["read", "find", "grep", "ls"], strictToolNames: true,
    isolatedSessionDir: workflowChildSessionDir(),
    ...(model ? { initialModel: model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });
  try {
    await session.waitUntilReady();
    const tools = await session.send({ type: "get_tools" }) as Array<{ name: string; active: boolean }>;
    const activeTools = tools.filter(tool => tool.active).map(tool => tool.name).sort();
    if (JSON.stringify(activeTools) !== JSON.stringify(["find", "grep", "ls", "read"])) throw new Error("子任务工具范围未能隔离");
  } catch (error) {
    session.destroy();
    throw error;
  }
  let error = "";
  let finished = false;
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>(resolve => { resolveDone = resolve; });
  const unsubscribe = session.onEvent(event => {
    if (event.type === "prompt_error") error = String(event.errorMessage || "子任务执行失败");
    if (event.type === "prompt_done" && !finished) { finished = true; resolveDone?.(); }
  });
  const abort = () => { void session.send({ type: "abort" }).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { error = "子任务超时"; abort(); if (!finished) { finished = true; resolveDone?.(); } }, 10 * 60_000);
  try {
    await session.send({ type: "prompt", message: [
      `你是工作流中的「${agent.name}」。只完成当前子任务，使用只读工具；不要写入文件、调用外部连接、创建其他任务或声称已执行未完成的操作。`,
      `当前子任务：${agent.task}`,
      ...(previous ? [`上一阶段的结果：\n${previous}`] : []),
      "请给出可核对的简明结果；查不到时说明缺口。",
    ].join("\n\n") });
    await done;
    const summary = !error && !signal?.aborted ? assistantText(session.sessionFile).slice(0, 4000) : "";
    return { ok: Boolean(summary) && !error && !signal?.aborted,
      summary: error || (signal?.aborted ? "已中断" : summary || "没有可核对的结果") };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.destroy();
  }
}

export function createEduPiWorkflowTool({ runAgent = runReadOnlyAgent }: { runAgent?: typeof runReadOnlyAgent } = {}) {
  return defineTool<typeof parameters, { runId?: string; status: string }>({
    name: "edupi_workflow",
    label: "动态工作流",
    description: "用户明确要求多阶段、并行子任务或工作流时使用。先按请求生成有名称的阶段和子任务，给用户查看并确认后才运行。每个子任务是独立的只读 Pi 会话，同阶段并行，阶段间传递摘要。子任务不能写文件或执行命令；需要修改、发送或发布时由主会话使用原有工具另行完成并验收。不要为普通单步提问调用。",
    promptSnippet: "edupi_workflow: 经用户确认后运行有名称的多阶段只读子任务，并在流程图显示实际进度",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, plan: Parameters, signal, _onUpdate, ctx) => {
      validateDynamicWorkflowPlan(plan);
      const source = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
      if (!source || !ctx.hasUI) return { content: [{ type: "text", text: "工作流需要当前用户消息和可见的确认界面。" }], details: { status: "blocked" } };
      const preview = [
        `工作区：${ctx.cwd}`,
        `模型：${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "当前默认模型"}`,
        `子任务：${plan.phases.reduce((count, phase) => count + phase.agents.length, 0)} 项，每项调用一次模型`,
        ...plan.phases.flatMap((phase, index) => [
          `${index + 1}. ${phase.name}`,
          ...phase.agents.map(agent => `  ${agent.name}：${agent.task}`),
        ]),
        "子任务可读取本地文件，相关内容会进入所选模型的上下文；不会执行命令、写入或调用连接器。",
      ].join("\n");
      if (!await ctx.ui.confirm("运行工作流", preview)) {
        return { content: [{ type: "text", text: "工作流未启动。" }], details: { status: "declined" } };
      }
      signal?.throwIfAborted();
      const run = makeDynamicWorkflowRun(ctx.sessionManager.getSessionId(), source.id, plan);
      const { run: final, results } = await executeDynamicWorkflow(run, plan,
        (agent, previous, childSignal) => runAgent(agent, previous, ctx.cwd,
          ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : undefined,
          ctx.thinkingLevel, childSignal), signal);
      const report = results.flatMap((phase, phaseIndex) => phase.map((result, agentIndex) =>
        `${final.phases[phaseIndex].name} / ${final.phases[phaseIndex].agents[agentIndex].name}：${result.ok ? result.summary : `失败：${result.summary}`}`));
      return { content: [{ type: "text", text: `工作流${final.status === "done" ? "完成" : "未完成"}。\n${report.join("\n\n").slice(0, 20_000)}` }],
        details: { runId: final.id, status: final.status }, isError: final.status !== "done" };
    },
  });
}
