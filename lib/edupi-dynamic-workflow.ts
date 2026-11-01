import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type DynamicWorkflowStatus = "pending" | "running" | "done" | "failed" | "interrupted" | "skipped";
export type DynamicWorkflowAgent = { id: string; name: string; status: DynamicWorkflowStatus };
export type DynamicWorkflowPhase = { id: string; name: string; status: DynamicWorkflowStatus; visits: number; agents: DynamicWorkflowAgent[] };
export type DynamicWorkflowPlan = { title: string; phases: Array<{
  name: string;
  agents: Array<{ name: string; task: string; output?: "summary" | "draft" }>;
  on_success?: number | "finish";
  on_failure?: number | "finish";
  max_visits?: number;
}> };
export type DynamicWorkflowAgentResult = { ok: boolean; summary: string; draft?: boolean };
export type DynamicWorkflowVisit = { phaseIndex: number; visit: number; results: DynamicWorkflowAgentResult[] };
export type PublicDynamicWorkflowRun = {
  version: 2;
  id: string;
  sessionId: string;
  sourceEntryId: string;
  title: string;
  status: DynamicWorkflowStatus;
  createdAt: string;
  updatedAt: string;
  phases: DynamicWorkflowPhase[];
};
export type DynamicWorkflowRun = PublicDynamicWorkflowRun & {
  plan: DynamicWorkflowPlan;
  cursor: number | null;
  activePhaseIndex: number | null;
  results: Array<Array<DynamicWorkflowAgentResult | null>>;
  lastSummary: string;
  transitions: number;
};

const MAX_PHASES = 6;
const MAX_AGENTS_PER_PHASE = 4;
const MAX_AGENT_INVOCATIONS = 32;
// At most 24 distinct agents each retain 4,000 characters. JSON escaping and
// multibyte text can use more than six bytes per character; keep the cap above
// that validated worst case while still bounding one private journal file.
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TRANSITIONS = 20;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const active = (globalThis as typeof globalThis & { __edupiWorkflowRuns?: Set<string> }).__edupiWorkflowRuns ??= new Set<string>();

function label(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= limit && !/[\r\n\u0000-\u001f]/u.test(value);
}

function visitsLimit(phase: DynamicWorkflowPlan["phases"][number]): number { return phase.max_visits ?? 1; }

export function maximumWorkflowAgentCalls(plan: DynamicWorkflowPlan): number {
  return plan.phases.reduce((count, phase) => count + phase.agents.length * visitsLimit(phase), 0);
}

export function validateDynamicWorkflowPlan(value: unknown): asserts value is DynamicWorkflowPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作流计划无效");
  const plan = value as Partial<DynamicWorkflowPlan>;
  if (!label(plan.title, 80) || !Array.isArray(plan.phases) || plan.phases.length < 1 || plan.phases.length > MAX_PHASES) throw new Error("工作流阶段需为 1–6 个");
  for (let index = 0; index < plan.phases.length; index++) {
    const phase = plan.phases[index];
    if (!label(phase?.name, 60) || !Array.isArray(phase.agents) || phase.agents.length < 1 || phase.agents.length > MAX_AGENTS_PER_PHASE) throw new Error("每阶段需有 1–4 个子任务");
    if (phase.max_visits !== undefined && (!Number.isInteger(phase.max_visits) || phase.max_visits < 1 || phase.max_visits > 3)) throw new Error("阶段重试上限需为 1–3 次");
    for (const agent of phase.agents) {
      if (!label(agent?.name, 48) || !label(agent?.task, 500)
        || agent.output !== undefined && !["summary", "draft"].includes(agent.output)) throw new Error("子任务名称、要求或产出类型无效");
    }
    for (const [edge, target] of [["on_success", phase.on_success], ["on_failure", phase.on_failure]] as const) {
      if (target === undefined || target === "finish") continue;
      if (!Number.isInteger(target) || target < 0 || target >= plan.phases.length) throw new Error("阶段分支目标无效");
      if (target <= index && (plan.phases[target].max_visits ?? 1) < 2) throw new Error(`${edge} 回到旧阶段时需声明重试上限`);
    }
  }
  if (maximumWorkflowAgentCalls(plan as DynamicWorkflowPlan) > MAX_AGENT_INVOCATIONS) throw new Error("工作流最多允许 32 次模型调用");
}

function stateDirectory(create: boolean): string | null {
  const base = process.env.PI_DESKTOP_STATE_DIR?.trim() || getAgentDir();
  if (!path.isAbsolute(base)) throw new Error("工作流状态目录无效");
  const root = path.join(base, "edupi-dynamic-workflows-v2");
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  else if (!fs.existsSync(root)) return null;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("工作流状态目录不安全");
  return root;
}

export function workflowChildSessionDir(): string {
  const root = stateDirectory(true)!;
  const child = path.join(root, "child-sessions");
  fs.mkdirSync(child, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(child);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工作流会话目录不安全");
  return child;
}

function runFile(root: string, sessionId: string): string {
  if (!ID.test(sessionId)) throw new Error("会话 ID 无效");
  return path.join(root, `${createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function isStatus(value: unknown): value is DynamicWorkflowStatus {
  return ["pending", "running", "done", "failed", "interrupted", "skipped"].includes(String(value));
}

function isResult(value: unknown): value is DynamicWorkflowAgentResult {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && typeof (value as DynamicWorkflowAgentResult).ok === "boolean"
    && typeof (value as DynamicWorkflowAgentResult).summary === "string"
    && (value as DynamicWorkflowAgentResult).summary.length <= 4000
    && ((value as DynamicWorkflowAgentResult).draft === undefined || typeof (value as DynamicWorkflowAgentResult).draft === "boolean");
}

function isRun(value: unknown, sessionId: string): value is DynamicWorkflowRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as DynamicWorkflowRun;
  try { validateDynamicWorkflowPlan(run.plan); } catch { return false; }
  return run.version === 2 && ID.test(run.id) && run.sessionId === sessionId && ID.test(run.sourceEntryId)
    && run.title === run.plan.title && isStatus(run.status)
    && !Number.isNaN(Date.parse(run.createdAt)) && !Number.isNaN(Date.parse(run.updatedAt))
    && (run.cursor === null || Number.isInteger(run.cursor) && run.cursor >= 0 && run.cursor < run.plan.phases.length)
    && (run.activePhaseIndex === null || Number.isInteger(run.activePhaseIndex) && run.activePhaseIndex >= 0 && run.activePhaseIndex < run.plan.phases.length)
    && Number.isInteger(run.transitions) && run.transitions >= 0 && run.transitions <= MAX_TRANSITIONS
    && typeof run.lastSummary === "string" && run.lastSummary.length <= 5000
    && Array.isArray(run.phases) && run.phases.length === run.plan.phases.length
    && Array.isArray(run.results) && run.results.length === run.plan.phases.length
    && run.phases.every((phase, index) => ID.test(phase.id) && phase.name === run.plan.phases[index].name && isStatus(phase.status)
      && Number.isInteger(phase.visits) && phase.visits >= 0 && phase.visits <= visitsLimit(run.plan.phases[index])
      && Array.isArray(phase.agents) && phase.agents.length === run.plan.phases[index].agents.length
      && phase.agents.every((agent, agentIndex) => ID.test(agent.id) && agent.name === run.plan.phases[index].agents[agentIndex].name && isStatus(agent.status))
      && Array.isArray(run.results[index]) && run.results[index].length === phase.agents.length
      && run.results[index].every(result => result === null || isResult(result)));
}

/** The browser receives only names and states. Prompts and summaries stay in a private 0600 journal. */
export function publicDynamicWorkflowRun(run: DynamicWorkflowRun): PublicDynamicWorkflowRun {
  return { version: 2, id: run.id, sessionId: run.sessionId, sourceEntryId: run.sourceEntryId,
    title: run.title, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt,
    phases: run.phases.map(phase => ({ ...phase, agents: phase.agents.map(agent => ({ ...agent })) })) };
}

export function writeDynamicWorkflowRun(run: DynamicWorkflowRun): void {
  if (!isRun(run, run.sessionId)) throw new Error("工作流状态无效");
  const root = stateDirectory(true)!;
  const file = runFile(root, run.sessionId);
  const bytes = Buffer.from(`${JSON.stringify(run)}\n`, "utf8");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("工作流状态过大");
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("工作流状态文件不安全");
  }
  const temporary = path.join(root, `.workflow-${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file);
    try {
      const directory = fs.openSync(root, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch { /* Some filesystems do not support directory fsync. */ }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function readDynamicWorkflowRun(sessionId: string): DynamicWorkflowRun | null {
  const root = stateDirectory(false);
  if (!root) return null;
  const file = runFile(root, sessionId);
  if (!fs.existsSync(file)) return null;
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let value: unknown;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("工作流状态文件不安全");
    value = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally { fs.closeSync(descriptor); }
  if (!isRun(value, sessionId)) throw new Error("工作流状态无效");
  if (value.status === "running" && !active.has(value.id) && Date.now() - Date.parse(value.updatedAt) > 30_000) {
    return { ...value, status: "interrupted", phases: value.phases.map(phase => ({ ...phase,
      status: phase.status === "running" ? "interrupted" : phase.status,
      agents: phase.agents.map(agent => ({ ...agent, status: agent.status === "running" ? "interrupted" : agent.status })) })) };
  }
  return value;
}

export function makeDynamicWorkflowRun(sessionId: string, sourceEntryId: string, plan: DynamicWorkflowPlan): DynamicWorkflowRun {
  validateDynamicWorkflowPlan(plan);
  if (!ID.test(sessionId) || !ID.test(sourceEntryId)) throw new Error("工作流来源会话无效");
  const now = new Date().toISOString();
  return { version: 2, id: randomUUID(), sessionId, sourceEntryId, title: plan.title,
    status: "pending", createdAt: now, updatedAt: now, cursor: 0, activePhaseIndex: null,
    plan, lastSummary: "", transitions: 0,
    results: plan.phases.map(phase => phase.agents.map(() => null)),
    phases: plan.phases.map((phase, phaseIndex) => ({ id: `phase-${phaseIndex}`, name: phase.name, status: "pending", visits: 0,
      agents: phase.agents.map((agent, agentIndex) => ({ id: `agent-${phaseIndex}-${agentIndex}`, name: agent.name, status: "pending" })) })) };
}

function finishRun(run: DynamicWorkflowRun, status: "done" | "failed" | "interrupted"): void {
  run.status = status;
  run.cursor = null;
  run.activePhaseIndex = null;
  for (const phase of run.phases) {
    if (phase.status !== "pending") continue;
    phase.status = status === "done" ? "skipped" : "interrupted";
    for (const agent of phase.agents) agent.status = phase.status;
  }
}

export async function executeDynamicWorkflow(
  run: DynamicWorkflowRun,
  plan: DynamicWorkflowPlan,
  executeAgent: (agent: { name: string; task: string }, previous: string, signal?: AbortSignal) => Promise<DynamicWorkflowAgentResult>,
  signal?: AbortSignal,
  write: (state: DynamicWorkflowRun) => void | Promise<void> = writeDynamicWorkflowRun,
): Promise<{ run: DynamicWorkflowRun; results: DynamicWorkflowVisit[] }> {
  validateDynamicWorkflowPlan(plan);
  if (!isRun(run, run.sessionId) || JSON.stringify(plan) !== JSON.stringify(run.plan)
    || !["pending", "interrupted"].includes(run.status) || run.cursor === null) throw new Error("工作流状态不可恢复");
  let writes = Promise.resolve();
  const persist = () => {
    run.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(run);
    writes = writes.then(() => write(snapshot));
    return writes;
  };
  const visits: DynamicWorkflowVisit[] = [];
  active.add(run.id);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    run.status = "running";
    await persist();
    heartbeat = setInterval(() => { void persist().catch(() => {}); }, 10_000);
    while (run.cursor !== null) {
      signal?.throwIfAborted();
      const index: number = run.cursor;
      const phase = run.phases[index];
      const definition: DynamicWorkflowPlan["phases"][number] = plan.phases[index];
      if (run.transitions >= MAX_TRANSITIONS || run.activePhaseIndex !== index && phase.visits >= visitsLimit(definition)) {
        finishRun(run, "failed");
        await persist();
        break;
      }
      if (run.activePhaseIndex !== index) {
        phase.visits++;
        phase.status = "running";
        phase.agents.forEach(agent => { agent.status = "running"; });
        run.results[index] = definition.agents.map(() => null);
        run.activePhaseIndex = index;
      } else {
        phase.status = "running";
        phase.agents.forEach((agent, agentIndex) => {
          if (!["done", "failed"].includes(agent.status) || !run.results[index][agentIndex]) agent.status = "running";
        });
      }
      await persist();
      const previous = run.lastSummary;
      const settled: DynamicWorkflowAgentResult[] = await Promise.all(definition.agents.map(async (agent, agentIndex) => {
        const saved = run.results[index][agentIndex];
        if (["done", "failed"].includes(phase.agents[agentIndex].status) && saved) return saved;
        let outcome: DynamicWorkflowAgentResult;
        try { outcome = await executeAgent(agent, previous, signal); }
        catch (error) { outcome = { ok: false, summary: error instanceof Error ? error.message.slice(0, 4000) : "子任务失败" }; }
        const interrupted = signal?.aborted;
        phase.agents[agentIndex].status = interrupted ? "interrupted" : outcome.ok ? "done" : "failed";
        run.results[index][agentIndex] = interrupted ? null : { ok: outcome.ok, summary: outcome.summary.slice(0, 4000),
          ...(outcome.draft ? { draft: true } : {}) };
        await persist();
        return outcome;
      }));
      signal?.throwIfAborted();
      const succeeded: boolean = settled.every(item => item.ok);
      phase.status = succeeded ? "done" : "failed";
      visits.push({ phaseIndex: index, visit: phase.visits, results: settled });
      run.lastSummary = settled.map((item, agentIndex) => `${phase.agents[agentIndex].name}: ${item.summary.slice(0, 1600)}`).join("\n").slice(0, 5000);
      run.activePhaseIndex = null;
      run.transitions++;
      const edge: number | "finish" | undefined = succeeded ? definition.on_success : definition.on_failure;
      const next: number | "finish" = edge ?? (succeeded && index + 1 < plan.phases.length ? index + 1 : "finish");
      if (next === "finish") finishRun(run, succeeded ? "done" : "failed");
      else run.cursor = next;
      await persist();
    }
    return { run, results: visits };
  } catch (error) {
    run.status = signal?.aborted ? "interrupted" : "failed";
    for (const phase of run.phases) {
      if (phase.status !== "running") continue;
      phase.status = run.status;
      for (const agent of phase.agents) if (agent.status === "running") agent.status = run.status;
    }
    await persist();
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    active.delete(run.id);
  }
}
