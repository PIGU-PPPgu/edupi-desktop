import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MODEL_SETUP_PRESETS,
  hasUsableModelSetup,
  pickSetupModel,
} = await jiti.import("./model-setup-presets.ts");

test("common setup presets point to official key pages and working API roots", () => {
  const byId = Object.fromEntries(MODEL_SETUP_PRESETS.map((preset) => [preset.id, preset]));

  assert.equal(byId.openai.keyUrl, "https://platform.openai.com/api-keys");
  assert.equal(byId.openai.baseUrl, "https://api.openai.com/v1");
  assert.equal(byId.anthropic.keyUrl, "https://platform.claude.com/settings/keys");
  assert.equal(byId.google.keyUrl, "https://aistudio.google.com/apikey");
  assert.equal(byId.deepseek.keyUrl, "https://platform.deepseek.com/api_keys");
  assert.equal(byId["moonshotai-cn"].keyUrl, "https://platform.kimi.com/console/api-keys");
  assert.ok(MODEL_SETUP_PRESETS.every((preset) => new URL(preset.keyUrl).protocol === "https:"));
});

test("first-run setup stays hidden when either a custom model or managed login is ready", () => {
  assert.equal(hasUsableModelSetup({ providers: {} }, false), false);
  assert.equal(hasUsableModelSetup({ providers: { empty: { models: [] } } }, false), false);
  assert.equal(hasUsableModelSetup({ providers: { ready: { models: [{ id: "model-1" }] } } }, false), true);
  assert.equal(hasUsableModelSetup({ providers: {} }, true), true);
});

test("model choice prefers a provider hint without inventing an unavailable model", () => {
  const models = [
    { id: "legacy-model" },
    { id: "gpt-5-mini", name: "GPT-5 mini" },
    { id: "gpt-5" },
  ];

  assert.equal(pickSetupModel(models, ["gpt-5", "gpt"]), "gpt-5");
  assert.equal(pickSetupModel(models, ["missing"]), "legacy-model");
  assert.equal(pickSetupModel([], ["gpt-5"]), "");
});
