import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

// The parent owns this worker's lifetime; closing the desktop server ends it.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
const emit = (result) => process.stdout.write(JSON.stringify(result) + "\n");
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
  const { createCalendarWorkModelRunner } = await import(pathToFileURL(path.join(root, "scripts/calendar_work_model_runner.mjs")).href);
  const result = await run({ horizonDays: 2, runModel: createCalendarWorkModelRunner({ modelRuntime: runtime, model, cwd, agentDir }), outputDir: process.env.EDUPI_OUTPUT_DIR });
  const prepared = (result.execution_results || []).filter((item) => item.status === "draft_ready" && !item.replayed).length;
  const ok = !(result.failed_count > 0);
  emit({ ok, prepared, skipped: result.skipped_count || 0, ...(ok ? {} : { code: "preparation_failed" }) });
  process.exit(ok ? 0 : 1);
} catch (error) {
  emit({ ok: false, code: error?.code === "model_unavailable" || error?.message === "model_unavailable" ? "model_unavailable" : "preparation_failed" });
  process.exit(1);
}
