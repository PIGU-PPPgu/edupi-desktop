import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAgentSession, createExtensionRuntime, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// The parent owns this worker's lifetime; closing the desktop server ends it.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
const emit = (result) => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(result) + "\n", (error) => error ? reject(error) : resolve()));
try {
  const cwd = process.env.EDUPI_PROJECT_ROOT;
  const root = process.env.EDUPI_CORE_ROOT;
  if (!cwd || !root) throw new Error("configuration");
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
  const result = await run({ horizonDays: 2, runModel, outputDir: process.env.EDUPI_OUTPUT_DIR });
  const prepared = (result.execution_results || []).filter((item) => item.status === "draft_ready" && !item.replayed).length;
  const ok = !(result.failed_count > 0);
  await emit({ ok, prepared, skipped: result.skipped_count || 0, ...(ok ? {} : { code: "preparation_failed" }) });
  process.exit(ok ? 0 : 1);
} catch (error) {
  await emit({ ok: false, code: error?.code === "model_unavailable" || error?.message === "model_unavailable" ? "model_unavailable" : "preparation_failed" });
  process.exit(1);
}
