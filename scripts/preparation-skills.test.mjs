import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparationSkillsPrompt } from "../desktop/preparation-skills.mjs";
import { generateValidatedArtifacts } from "../desktop/model-output-repair.mjs";

test("preparation sends published method bodies and source IDs through the generation prompt", { skip: !process.env.EDUPI_CORE_ROOT }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-preparation-skill-prompt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "skills", "cube", "SKILL.md");
  const store = path.join(root, ".edupi/evolution/evolutions.json");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(store), { recursive: true });
  const body = "# 正方体展开图\n" + "教学背景\n".repeat(120) + "操作步骤：用橙色方格纸折叠验证相对面。";
  fs.writeFileSync(source, body);
  fs.writeFileSync(store, JSON.stringify({ records: [{ id: "evo-cube", topic: "正方体展开图", status: "promoted", teacher_approval: { status: "accepted" }, session_loads: [{ route_verified: true }], active_skill_path: source, trial_uses: 3 }] }));
  const before = fs.readFileSync(store, "utf8");
  const options = { coreRoot: process.env.EDUPI_CORE_ROOT, projectRoot: root, candidate: { title: "正方体展开图", deliverables: ["学案"] } };
  const prompt = await preparationSkillsPrompt("原始备课要求", options);
  assert.ok(prompt.includes("橙色方格纸"));
  assert.ok(prompt.includes('"skillId":"evo-cube"'));
  // A session double proves delivery to the model boundary, not model compliance.
  let sent;
  const output = JSON.stringify({ artifacts: [{ title: "学案", content: "测试产物" }] });
  const session = { state: { messages: [] }, async prompt(text) { sent = text; this.state.messages.push({ role: "assistant", content: [{ type: "text", text: output }] }); } };
  assert.equal(await generateValidatedArtifacts(session, prompt, options.candidate, JSON.parse), output);
  assert.equal(sent, prompt);
  assert.equal(fs.readFileSync(store, "utf8"), before);
  assert.equal(await preparationSkillsPrompt("原始备课要求", { ...options, candidate: { title: "诗歌朗读" } }), "原始备课要求");
});
