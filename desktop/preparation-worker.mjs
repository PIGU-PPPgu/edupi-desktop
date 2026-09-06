import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAgentSession, createExtensionRuntime, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// The parent owns this worker's lifetime; closing the desktop server ends it.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
const emit = (result) => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(result) + "\n", (error) => error ? reject(error) : resolve()));
let kernel;
let kernelRunId;
try {
  const cwd = process.env.EDUPI_PROJECT_ROOT;
  const root = process.env.EDUPI_CORE_ROOT;
  if (!cwd || !root) throw new Error("configuration");
  const { runMorningBrief } = await import(pathToFileURL(path.join(root, "scripts/desktop_daily_brief.mjs")).href);
  runMorningBrief();
  const { ProactiveWorkKernel } = await import(pathToFileURL(path.join(root, "scripts/proactive_work_kernel.mjs")).href);
  kernel = new ProactiveWorkKernel();
  const requestedTaskId=process.env.EDUPI_PREPARE_TASK_ID||null;
  const claim = kernel.claim({ trigger_id: "teaching_preparation", trigger_kind: requestedTaskId ? "manual" : "schedule", runner_id: "desktop_preparation", external_send: false }, requestedTaskId ? `${requestedTaskId}:${Date.now()}` : new Date().toISOString().slice(0, 13));
  if (!claim.claimed) { await emit({ ok: true, prepared: 0, skipped: 1 }); process.exit(0); }
  kernelRunId = claim.run.run_id;
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir);
  const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json") });
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  const model = provider && modelId ? runtime.getModel(provider, modelId) : null;
  if (!model) throw new Error("model_unavailable");
  const { run } = await import(pathToFileURL(path.join(root, "scripts/calendar_work_heartbeat.mjs")).href);
  // The host supplies Pi; Core owns candidate selection and artifact storage.
  const runModel = async ({ prompt }) => {
    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => undefined, getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {},
    };
    const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({ packages: [], extensions: [], skills: [], prompts: [], themes: [], retry: { enabled: false }, compaction: { enabled: false } }), resourceLoader, tools: [], noTools: "all" });
    try {
      await session.prompt(prompt);
      const last = [...session.state.messages].reverse().find((message) => message.role === "assistant");
      const output = last?.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      if (!output || last.stopReason === "error" || last.stopReason === "aborted") throw new Error("model_unavailable");
      return { output, provider: model.provider, model: model.id, session_id: session.sessionId };
    } finally { session.dispose(); }
  };
  const result = await run({ horizonDays: 2, runModel, outputDir: process.env.EDUPI_OUTPUT_DIR,requestedTaskId });
  const prepared = (result.execution_results || []).filter((item) => item.status === "draft_ready" && !item.replayed).length;
  const ok = !(result.failed_count > 0) && (!requestedTaskId || (result.execution_results||[]).some(item=>item.task_id===requestedTaskId&&item.status==="draft_ready"));
  if (ok) kernel.complete(kernelRunId, { resultSummary: `已准备 ${prepared} 项教学工作`, resultCount: prepared });
  else kernel.fail(kernelRunId, new Error("备课未完成"), { code: "preparation_failed" });
  await emit({ ok, prepared, skipped: result.skipped_count || 0, ...(ok ? {} : { code: "preparation_failed" }) });
  process.exit(ok ? 0 : 1);
} catch (error) {
  if (kernel && kernelRunId) kernel.fail(kernelRunId, error);
  await emit({ ok: false, code: error?.code === "model_unavailable" || error?.message === "model_unavailable" ? "model_unavailable" : "preparation_failed" });
  process.exit(1);
}
