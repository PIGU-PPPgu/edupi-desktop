import assert from "node:assert/strict";
import test from "node:test";
import { verifyCloudWrite, CloudReadbackError } from "./edupi-cloud-verification.ts";

test("fact writes require matching account workspace, object, revision, status and value", async () => {
  const body = { action: "modify", request_id: "modify-fact", fact_id: "fact-a", expected_revision: 2, replacement_value: "新值" };
  const result = { ok: true, operation: "education-facts", request_id: body.request_id, action: body.action,
    fact_id: "fact-a", result_fact_id: "fact-a", revision: 3, status: "accepted", external_send: false };
  const fact = { workspace_id: "workspace-a", fact_id: "fact-a", revision: 3, status: "accepted", value: "新值" };
  await verifyCloudWrite("education-facts", body, result, "workspace-a", async () => ({ fact }));
  for (const changed of [{ workspace_id: "workspace-b" }, { fact_id: "fact-b" }, { revision: 2 }, { status: "candidate" }, { value: "旧值" }]) {
    await assert.rejects(verifyCloudWrite("education-facts", body, result, "workspace-a", async () => ({ fact: { ...fact, ...changed } })), CloudReadbackError);
  }
  await assert.rejects(verifyCloudWrite("education-facts", body, { ...result, revision: 2 }, "workspace-a", async () => ({ fact: { ...fact, revision: 2 } })), CloudReadbackError);
});

test("fact deletion and restore verify the durable lifecycle rather than row absence", async () => {
  const body = { action: "delete", request_id: "delete-fact", fact_id: "fact-a", expected_revision: 0 };
  const result = { ok: true, operation: "education-facts", request_id: body.request_id, action: body.action,
    fact_id: "fact-a", result_fact_id: "fact-a", revision: 1, status: "deleted", external_send: false };
  await verifyCloudWrite("education-facts", body, result, "workspace-a", async () => ({
    fact: { workspace_id: "workspace-a", fact_id: "fact-a", revision: 1, status: "deleted" },
  }));
  await assert.rejects(verifyCloudWrite("education-facts", body, result, "workspace-a", async () => ({})), CloudReadbackError);
});

test("material edits bind the version and the exact stored class_id patch", async () => {
  const body = { action: "update", request_id: "edit-material", material_id: "material-a", expected_revision: 0,
    patch: { title: "新标题", class_id: "class-a" } };
  const result = { ok: true, operation: "material-metadata", request_id: body.request_id, action: body.action,
    material_id: "material-a", version_id: "version-a", revision: 1, external_send: false };
  const material = { material_id: "material-a", title: "新标题", class_id: "class-a", metadata_revision: 1 };
  const version = { version_id: "version-a", request_id: body.request_id, revision: 1,
    after_values: { title: "新标题", class_id: "class-a" } };
  const reader = async op => op === "snapshot"
    ? { payload: { workspace_id: "workspace-a", materials: [material] } }
    : { materialMetadataVersions: { versions: [version] } };
  await verifyCloudWrite("material-metadata", body, result, "workspace-a", reader);
  await assert.rejects(verifyCloudWrite("material-metadata", { ...body, patch: { class_id: "another-class" } }, result, "workspace-a", reader), CloudReadbackError);
  await assert.rejects(verifyCloudWrite("material-metadata", body, { ...result, request_id: "another-request" }, "workspace-a", reader), CloudReadbackError);
});
