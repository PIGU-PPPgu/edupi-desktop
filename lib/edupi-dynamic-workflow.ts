import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type DynamicWorkflowStatus = "pending" | "running" | "done" | "failed" | "interrupted";
export type DynamicWorkflowAgent = { id: string; name: string; status: DynamicWorkflowStatus };
export type DynamicWorkflowPhase = { id: string; name: string; status: DynamicWorkflowStatus; agents: DynamicWorkflowAgent[] };
export type DynamicWorkflowRun = {
  version: 1;
  id: string;
  sessionId: string;
  sourceEntryId: string;
  title: string;
  status: DynamicWorkflowStatus;
  createdAt: string;
  updatedAt: string;
  phases: DynamicWorkflowPhase[];
};
export type DynamicWorkflowPlan = { title: string; phases: Array<{ name: string; agents: Array<{ name: string; task: string }> }> };
export type DynamicWorkflowAgentResult = { ok: boolean; summary: string };

const MAX_PHASES = 6;
const MAX_AGENTS_PER_PHASE = 4;
const MAX_AGENTS = 24;
const MAX_FILE_BYTES = 32 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const active = (globalThis as typeof globalThis & { __edupiWorkflowRuns?: Set<string> }).__edupiWorkflowRuns ??= new Set<string>();

function label(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= limit && !/[\r\n\u0000-\u001f]/u.test(value);
}

export function validateDynamicWorkflowPlan(value: unknown): asserts value is DynamicWorkflowPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作流计划无效");
  const plan = value as Partial<DynamicWorkflowPlan>;
  if (!label(plan.title, 80) || !Array.isArray(plan.phases) || plan.phases.length < 1 || plan.phases.length > MAX_PHASES) throw new Error("工作流阶段需为 1–6 个");
  let count = 0;
  for (const phase of plan.phases) {
    if (!label(phase?.name, 60) || !Array.isArray(phase.agents) || phase.agents.length < 1 || phase.agents.length > MAX_AGENTS_PER_PHASE) throw new Error("每阶段需有 1–4 个子任务");
    count += phase.agents.length;
    for (const agent of phase.agents) {
      if (!label(agent?.name, 48) || !label(agent?.task, 500)) throw new Error("子任务名称或要求无效");
    }
  }
  if (count > MAX_AGENTS) throw new Error("工作流最多 24 个子任务");
}

function stateDirectory(create: boolean): string | null {
  const base = process.env.PI_DESKTOP_STATE_DIR?.trim() || getAgentDir();
  if (!path.isAbsolute(base)) throw new Error("工作流状态目录无效");
  const root = path.join(base, "edupi-dynamic-workflows-v1");
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  else if (!fs.existsSync(root)) return null;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("工作流状态目录不安全");
  return root;
}

export function workflowChildSessionDir(): string {
  const root = stateDirectory(true)!;
  const child = path.join(root, "child-sessions");
  fs.mkdirSync(child, { mode: 0o700 });
  const stat = fs.lstatSync(child);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工作流会话目录不安全");
  return child;
}

function runFile(root: string, sessionId: string): string {
  if (!ID.test(sessionId)) throw new Error("会话 ID 无效");
  return path.join(root, `${createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function isStatus(value: unknown): value is DynamicWorkflowStatus {
  return ["pending", "running", "done", "failed", "interrupted"].includes(String(value));
}

function isRun(value: unknown, sessionId: string): value is DynamicWorkflowRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as DynamicWorkflowRun;
  return run.version === 1 && ID.test(run.id) && run.sessionId === sessionId && ID.test(run.sourceEntryId)
    && label(run.title, 80) && isStatus(run.status) && !Number.isNaN(Date.parse(run.createdAt)) && !Number.isNaN(Date.parse(run.updatedAt))
    && Array.isArray(run.phases) && run.phases.length >= 1 && run.phases.length <= MAX_PHASES
    && run.phases.every(phase => ID.test(phase.id) && label(phase.name, 60) && isStatus(phase.status)
      && Array.isArray(phase.agents) && phase.agents.length >= 1 && phase.agents.length <= MAX_AGENTS_PER_PHASE
      && phase.agents.every(agent => ID.test(agent.id) && label(agent.name, 48) && isStatus(agent.status)));
}

/** The journal contains names and states only; task instructions and agent output stay in Pi's session. */
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
  return { version: 1, id: randomUUID(), sessionId, sourceEntryId, title: plan.title,
    status: "pending", createdAt: now, updatedAt: now,
    phases: plan.phases.map((phase, phaseIndex) => ({ id: `phase-${phaseIndex}`, name: phase.name, status: "pending",
      agents: phase.agents.map((agent, agentIndex) => ({ id: `agent-${phaseIndex}-${agentIndex}`, name: agent.name, status: "pending" })) })) };
}

export async function executeDynamicWorkflow(
  run: DynamicWorkflowRun,
  plan: DynamicWorkflowPlan,
  executeAgent: (agent: { name: string; task: string }, previous: string, signal?: AbortSignal) => Promise<DynamicWorkflowAgentResult>,
  signal?: AbortSignal,
  write: (state: DynamicWorkflowRun) => void | Promise<void> = writeDynamicWorkflowRun,
): Promise<{ run: DynamicWorkflowRun; results: DynamicWorkflowAgentResult[][] }> {
  validateDynamicWorkflowPlan(plan);
  if (run.phases.length !== plan.phases.length) throw new Error("工作流阶段与状态不一致");
  let writes = Promise.resolve();
  const persist = () => {
    run.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(run);
    writes = writes.then(() => write(snapshot));
    return writes;
  };
  const results: DynamicWorkflowAgentResult[][] = [];
  active.add(run.id);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    run.status = "running";
    await persist();
    heartbeat = setInterval(() => { void persist().catch(() => {}); }, 10_000);
    let previous = "";
    for (let index = 0; index < plan.phases.length; index++) {
      signal?.throwIfAborted();
      const phase = run.phases[index];
      phase.status = "running";
      for (const agent of phase.agents) agent.status = "running";
      await persist();
      const settled = await Promise.all(plan.phases[index].agents.map(async (agent, agentIndex) => {
        let outcome: DynamicWorkflowAgentResult;
        try { outcome = await executeAgent(agent, previous, signal); }
        catch (error) { outcome = { ok: false, summary: error instanceof Error ? error.message : "子任务失败" }; }
        phase.agents[agentIndex].status = signal?.aborted ? "interrupted" : outcome.ok ? "done" : "failed";
        await persist();
        return outcome;
      }));
      results.push(settled);
      phase.status = signal?.aborted ? "interrupted" : settled.every(item => item.ok) ? "done" : "failed";
      await persist();
      if (phase.status !== "done") break;
      previous = settled.map((item, agentIndex) => `${phase.agents[agentIndex].name}: ${item.summary.slice(0, 1600)}`).join("\n").slice(0, 5000);
    }
    run.status = signal?.aborted ? "interrupted" : run.phases.some(phase => phase.status === "failed") ? "failed" : "done";
    if (run.status !== "done") for (const phase of run.phases) {
      if (phase.status !== "pending") continue;
      phase.status = "interrupted";
      for (const agent of phase.agents) agent.status = "interrupted";
    }
    await persist();
    return { run, results };
  } catch (error) {
    run.status = signal?.aborted ? "interrupted" : "failed";
    for (const phase of run.phases) {
      if (phase.status !== "pending" && phase.status !== "running") continue;
      phase.status = run.status;
      for (const agent of phase.agents) if (agent.status === "pending" || agent.status === "running") agent.status = run.status;
    }
    await persist();
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    active.delete(run.id);
  }
}
