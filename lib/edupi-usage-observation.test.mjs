import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createJiti } from "jiti";

const api = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-usage-observation.ts");
const target = { kind: "work_candidate", targetId: "candidate-1", expectedRevision: 2 };
const observation = { target, action: "opportunity_visible", surface: "today", once: true };
function services({ collecting = true, consent = "consent-1", failRecord = false } = {}) {
  const prepared = [], recorded = [];
  return { prepared, recorded, dependencies: {
    crypto: webcrypto,
    readStatus: async () => ({ collecting, usage: { consent: { consent_ref: consent } } }),
    prepare: async input => { prepared.push(input); return input; },
    record: async event => { recorded.push(event); if (failRecord) throw Error("reply_unknown"); },
  } };
}

test("visible observations reuse one id per consent, target revision and surface", async () => {
  const service = services();
  assert.equal(await api.observeTeacherUsage(observation, service.dependencies), "recorded");
  await api.observeTeacherUsage(observation, service.dependencies);
  assert.equal(service.prepared[0].eventId, service.prepared[1].eventId);
  for (const change of [{ target: { ...target, expectedRevision: 3 } }, { surface: "task" }, { action: "draft_opened" }]) {
    await api.observeTeacherUsage({ ...observation, ...change }, service.dependencies);
    assert.notEqual(service.prepared.at(-1).eventId, service.prepared[0].eventId);
  }
  const nextConsent = services({ consent: "consent-2" });
  await api.observeTeacherUsage(observation, nextConsent.dependencies);
  assert.notEqual(nextConsent.prepared[0].eventId, service.prepared[0].eventId);
  assert.deepEqual(Object.keys(service.prepared[0]).sort(), ["action", "eventId", "occurredAt", "sessionId", "surface", "target"]);
});

test("explicit actions are distinct and disabled or unbound observations do not prepare", async () => {
  const service = services();
  await api.observeTeacherUsage({ ...observation, action: "manual_prepare", once: false }, service.dependencies);
  await api.observeTeacherUsage({ ...observation, action: "manual_prepare", once: false }, service.dependencies);
  assert.notEqual(service.prepared[0].eventId, service.prepared[1].eventId);
  const disabled = services({ collecting: false });
  assert.equal(await api.observeTeacherUsage(observation, disabled.dependencies), "disabled");
  assert.equal(disabled.prepared.length, 0);
  assert.equal(await api.observeTeacherUsage({ ...observation, target: null }, service.dependencies), "disabled");
  assert.equal(await api.observeTeacherUsage({ ...observation, target: { kind: "artifact", targetId: "artifact-1" } }, service.dependencies), "disabled");
});

test("unknown record replies retain the exact prepared event and never count as success", async () => {
  const service = services({ failRecord: true });
  assert.equal(await api.observeTeacherUsage(observation, service.dependencies), "deferred");
  assert.equal(service.recorded[0], service.prepared[0]);
  assert.equal(service.recorded.length, 1);
});

test("artifact observations bind only the current exact projected path and revision", () => {
  const artifact = { id: "artifact-1", relativePath: ".edupi/output/capability/draft.md", revision: 3, externalSend: false };
  const workCase = { externalSend: false, artifacts: [artifact] };
  const file = "/synthetic/.edupi/output/capability/draft.md";
  assert.deepEqual(api.projectedArtifactUsageTarget("/synthetic", file, [workCase]), { kind: "artifact", targetId: "artifact-1", expectedRevision: 3 });
  assert.equal(api.projectedArtifactUsageTarget("/foreign", file, [workCase]), null);
  assert.equal(api.projectedArtifactUsageTarget("/synthetic", "/synthetic/teacher.pdf", [workCase]), null);
  assert.equal(api.projectedArtifactUsageTarget("/synthetic", file, [workCase, { ...workCase, artifacts: [{ ...artifact, id: "artifact-2" }] }]), null);
  for (const patch of [{ relativePath: ".edupi/output/../draft.md" }, { revision: 0 }, { externalSend: true }]) {
    assert.equal(api.projectedArtifactUsageTarget("/synthetic", file, [{ ...workCase, artifacts: [{ ...artifact, ...patch }] }]), null);
  }
});
