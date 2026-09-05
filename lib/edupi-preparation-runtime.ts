import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";

type PreparationStatus = { state: "idle" | "running" | "ready" | "error"; updatedAt: string | null; prepared: number; error: string | null; taskId?:string|null };
type Runtime = { status: PreparationStatus; timer?: ReturnType<typeof setInterval>; running?: boolean };
const shared = globalThis as typeof globalThis & { __edupiPreparation?: Runtime };
const runtime = () => shared.__edupiPreparation ??= { status: { state: "idle", updatedAt: null, prepared: 0, error: null } };
export const preparationStatus = (): PreparationStatus => ({ ...runtime().status });

export function startPreparation({taskId=null}:{taskId?:string|null}={}) {
  const state = runtime();
  if(taskId && (taskId.length>160 || /[\r\n]/.test(taskId)))throw new Error("任务标识无效");
  if(state.running&&taskId&&state.status.taskId!==taskId)throw new Error("已有备课任务正在运行，请完成后重试");
  if (state.running) return preparationStatus();
  const { runtime: core, dataRoot } = resolveEduPiBridgeRoots();
  const packagedWorker = path.join(process.cwd(), "preparation-worker.mjs");
  const worker = existsSync(packagedWorker) ? packagedWorker : path.join(process.cwd(), "desktop/preparation-worker.mjs");
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", TZ: process.env.TZ || "Asia/Shanghai", EDUPI_CORE_ROOT: core.root, EDUPI_PROJECT_ROOT: dataRoot.root, EDUPI_MEMORY_DIR: dataRoot.memoryDir, EDUPI_OUTPUT_DIR: dataRoot.outputDir, EDUPI_LOCK_DIR: dataRoot.lockDir };
  delete env.PI_DESKTOP_API_TOKEN;
  delete env.PI_DESKTOP_INSTANCE_ID;
  if(taskId)env.EDUPI_PREPARE_TASK_ID=taskId;else delete env.EDUPI_PREPARE_TASK_ID;
  const child = spawn(process.execPath, [worker], { cwd: process.cwd(), env, stdio: ["pipe", "pipe", "ignore"] });
  state.running = true;
  state.status = { ...state.status, taskId, state: "running", updatedAt: new Date().toISOString(), error: null };
  let output = "";
  let settled = false;
  const finish = (ok: boolean, prepared = 0, error = "备课未完成，请重试") => {
    if (settled) return;
    settled = true; clearTimeout(timeout); state.running = false;
    state.status = { taskId, state: ok ? "ready" : "error", updatedAt: new Date().toISOString(), prepared, error: ok ? null : error };
  };
  const timeout = setTimeout(() => { child.kill("SIGKILL"); finish(false, 0, "备课超时，请重试"); }, 5 * 60_000);
  child.stdout.on("data", (chunk) => { output += chunk.toString(); if (output.length > 64_000) { child.kill("SIGKILL"); finish(false); } });
  child.on("error", () => finish(false));
  child.on("close", (code) => {
    try {
      const result = JSON.parse(output.trim().split("\n").at(-1) || "{}");
      finish(code === 0 && result.ok === true, Number(result.prepared) || 0, result.code === "model_unavailable" ? "请先在管理中心配置默认模型" : undefined);
    } catch { finish(false); }
  });
  return preparationStatus();
}

export function ensurePreparation() {
  const state = runtime();
  if (!state.timer) {
    state.timer = setInterval(() => { try { startPreparation(); } catch { state.status = { ...state.status, state: "error", error: "教育工作区暂不可用" }; } }, 60 * 60_000);
    state.timer.unref();
    startPreparation();
  }
  return preparationStatus();
}
