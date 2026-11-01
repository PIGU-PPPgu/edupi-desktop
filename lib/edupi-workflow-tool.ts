import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { executeDynamicWorkflow, makeDynamicWorkflowRun, maximumWorkflowAgentCalls, readDynamicWorkflowRun, validateDynamicWorkflowPlan, workflowChildSessionDir,
  type DynamicWorkflowPlan } from "./edupi-dynamic-workflow";

const parameters = Type.Object({
  action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("resume")])),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  phases: Type.Optional(Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 60 }),
    agents: Type.Array(Type.Object({
      name: Type.String({ minLength: 1, maxLength: 48 }),
      task: Type.String({ minLength: 1, maxLength: 500 }),
      output: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("draft")])),
    }, { additionalProperties: false }), { minItems: 1, maxItems: 4 }),
    on_success: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 5 }), Type.Literal("finish")])),
    on_failure: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 5 }), Type.Literal("finish")])),
    max_visits: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 6 })),
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

type Agent = { name: string; task: string; output?: "summary" | "draft" };
type ChildModel = { provider: string; modelId: string };
type Parent = { sessionId: string; sourceEntryId: string };

async function runReadOnlyAgent(agent: Agent, previous: string, cwd: string, model: ChildModel | undefined,
  thinkingLevel: ThinkingLevel | undefined, parent: Parent, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { startHarnessSession } = await import("./harness/runtime");
  const { session } = await startHarnessSession(`workflow-${randomUUID()}`, "", cwd, {
    toolNames: ["read", "find", "grep", "ls"], strictToolNames: true,
    isolatedSessionDir: workflowChildSessionDir(),
    workflowParent: parent,
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
    signal?.throwIfAborted();
    await session.sendWorkflowChildPrompt({ type: "prompt", message: [
      `你是工作流中的「${agent.name}」。只完成当前子任务，使用只读工具；不要写入文件、调用外部连接、创建其他任务或声称已执行未完成的操作。`,
      `当前子任务：${agent.task}`,
      ...(agent.output === "draft" ? ["请生成可供审阅的草稿正文。草稿尚未采用，不要声称已保存到教师资料或对外发布。"] : []),
      ...(previous ? [`上一阶段的结果：\n${previous}`] : []),
      "请给出可核对的简明结果；查不到时说明缺口。",
    ].join("\n\n") });
    await done;
    const summary = !error && !signal?.aborted ? assistantText(session.sessionFile).slice(0, 4000) : "";
    return { ok: Boolean(summary) && !error && !signal?.aborted,
      ...(agent.output === "draft" && summary ? { draft: true } : {}),
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
    description: "用户明确要求多阶段、并行子任务或工作流时使用。start 按请求生成阶段，on_success/on_failure 可指向后续阶段编号（从 0 开始）或 finish；回到旧阶段须声明 max_visits，最多 3 次。resume 仅恢复同会话中断的只读工作流，已完成的子任务不重跑。每次启动或恢复均需用户确认。子任务不能写文件或执行命令；修改、发送和发布仍由主会话走原有门禁。不要为普通单步提问调用。",
    promptSnippet: "edupi_workflow: 经用户确认后运行或恢复有界多阶段只读子任务，并在流程图显示实际进度",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params: Parameters, signal, _onUpdate, ctx) => {
      const source = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "message" && entry.message.role === "user");
      if (!source || !ctx.hasUI) return { content: [{ type: "text", text: "工作流需要当前用户消息和可见的确认界面。" }], details: { status: "blocked" } };
      const sessionId = ctx.sessionManager.getSessionId();
      let plan: DynamicWorkflowPlan;
      let run;
      if (params.action === "resume") {
        const previous = readDynamicWorkflowRun(sessionId);
        if (!previous || previous.status !== "interrupted" || previous.cursor === null) return {
          content: [{ type: "text", text: "当前会话没有可恢复的工作流。" }], details: { status: "blocked" },
        };
        plan = previous.plan;
        run = previous;
      } else {
        const proposed: unknown = { title: params.title, phases: params.phases };
        validateDynamicWorkflowPlan(proposed);
        plan = proposed;
        run = makeDynamicWorkflowRun(sessionId, source.id, plan);
      }
      signal?.throwIfAborted();
      const action = params.action === "resume" ? "恢复工作流" : "运行工作流";
      const preview = [
        `工作区：${ctx.cwd}`,
        `模型：${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "当前默认模型"}`,
        `子任务：${plan.phases.reduce((count, phase) => count + phase.agents.length, 0)} 项，最多 ${maximumWorkflowAgentCalls(plan)} 次模型调用`,
        ...plan.phases.flatMap((phase, index) => [
          `${index + 1}. ${phase.name}${phase.max_visits ? `（最多 ${phase.max_visits} 轮）` : ""}`,
          ...phase.agents.map(agent => `  ${agent.name}：${agent.task}${agent.output === "draft" ? " · 待审草稿" : ""}`),
          ...(phase.on_success === undefined && phase.on_failure === undefined ? [] : [
            `  成功→${phase.on_success === "finish" ? "结束" : phase.on_success === undefined ? "下一阶段" : plan.phases[phase.on_success].name}；失败→${phase.on_failure === "finish" || phase.on_failure === undefined ? "结束" : plan.phases[phase.on_failure].name}`,
          ]),
        ]),
        "计划与结果会保存在本机私有状态目录，供中断后续跑；流程图只读取名称和状态。",
        "子任务可读取当前工作区，相关内容会进入所选模型的上下文；草稿须由主会话按原门禁采用，不会直接写入或调用连接器。",
      ].join("\n");
      if (!await ctx.ui.confirm(action, preview)) {
        return { content: [{ type: "text", text: "工作流未启动。" }], details: { status: "declined" } };
      }
      signal?.throwIfAborted();
      run.sourceEntryId = source.id;
      const { run: final } = await executeDynamicWorkflow(run, plan,
        (agent, previous, childSignal) => runAgent(agent, previous, ctx.cwd,
          ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : undefined,
          ctx.thinkingLevel, { sessionId: run.sessionId, sourceEntryId: source.id }, childSignal), signal);
      // A resumed invocation must return previously completed drafts too: the
      // interrupted tool call did not deliver its result to the parent chat.
      const report = final.results.flatMap((phaseResults, phaseIndex) => phaseResults.flatMap((result, agentIndex) => result ? [
        `${final.phases[phaseIndex].name} 第 ${final.phases[phaseIndex].visits} 轮 / ${final.phases[phaseIndex].agents[agentIndex].name}${result.draft ? "（待审草稿，未采用）" : ""}：${result.ok ? result.summary : `失败：${result.summary}`}`,
      ] : []));
      return { content: [{ type: "text", text: `工作流${final.status === "done" ? "完成" : "未完成"}。\n${report.join("\n\n").slice(0, 20_000)}` }],
        details: { runId: final.id, status: final.status }, isError: final.status !== "done" };
    },
  });
}
