import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCloudTaskEnvelope,
  assertCloudWriterContract,
  buildCloudTaskEnvelope,
  EDUPI_CLOUD_WRITER_CONTRACT,
} from "../lib/edupi-cloud-writer-contract.ts";
import { EDUPI_MOBILE_DASHBOARD_CONTRACT } from "../lib/edupi-cloud-contract.ts";

const migration = await readFile(new URL("./migrations/20261120142514_edupi_contract_foundation.sql", import.meta.url), "utf8");
const canonicalMigration = await readFile(new URL("./migrations/20261120163218_edupi_cloud_canonical_writer.sql", import.meta.url), "utf8");
const spineMigration = await readFile(new URL("./migrations/20261120183948_edupi_fact_spine_idempotency.sql", import.meta.url), "utf8");
const mobileMigration = await readFile(new URL("./migrations/20261121120000_edupi_mobile_snapshot.sql", import.meta.url), "utf8");
const mobileContractMigration = await readFile(new URL("./migrations/20261122041012_edupi_mobile_contract_registry.sql", import.meta.url), "utf8");
const bridge = JSON.parse(await readFile(new URL("../contracts/edupi-core-compat.json", import.meta.url), "utf8"));
const cloudWriter = JSON.parse(await readFile(new URL("../contracts/edupi-cloud-writer-v1.json", import.meta.url), "utf8"));
const mobileContract = JSON.parse(await readFile(new URL("../contracts/edupi-mobile-dashboard-v1.json", import.meta.url), "utf8"));
const studentFunction = await readFile(new URL("./functions/edupi-student-events/index.ts", import.meta.url), "utf8");
const classroomFunction = await readFile(new URL("./functions/edupi-classroom/index.ts", import.meta.url), "utf8");
const brokerFunction = await readFile(new URL("./functions/edupi-core-broker/index.ts", import.meta.url), "utf8");
const runtimeFunction = await readFile(new URL("./functions/edupi-core-runtime/index.ts", import.meta.url), "utf8");
const accountFunction = await readFile(new URL("./functions/edupi-account/index.ts", import.meta.url), "utf8");
const materialsFunction = await readFile(new URL("./functions/edupi-materials/index.ts", import.meta.url), "utf8");
const mobileAPI = await readFile(new URL("../ios/EduPi/EduPiRemoteAPI.swift", import.meta.url), "utf8");
const config = await readFile(new URL("./config.toml", import.meta.url), "utf8");

const cloudCoreCommit = "3ce22b1e08804aa36dccf59d76a8e61b15f2c462";
const localCoreCommit = "fc89b3bc899a55b0fdad61b8f37e238d950f37c6";
const cloudBridgeSchema = "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8";
const localBridgeSchema = "sha256:4d406ea05466f525d68e9a5c2e8f21b05a1013346fff5962a3ccc0ea61398b1d";
const occurrenceIdentity = {
  contract_id: "edupi-schedule-occurrence-v1.2",
  contract_version: "1.2",
  schema_hash: "sha256:b739852f427520f787ad32c7f41b258976a3b41d60fa6116439696c1495b97cb",
};
const deployedCommands = [
  "review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate",
  "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material",
  "create_task", "move_task_stage", "update_memory",
];

function contractRegistryRows(sql) {
  const inserts = [...sql.matchAll(/insert into edupi\.contract_versions\s*\(([\s\S]*?)\)\s*values\s*([\s\S]*?)\s*on conflict \(contract_id\)/gu)];
  assert.equal(inserts.length, 1, "migration must have exactly one contract registry insert");
  const [, columns, values] = inserts[0];
  assert.deepEqual(columns.split(",").map((column) => column.trim()), [
    "contract_id", "contract_version", "schema_hash", "core_commit", "supported_commands", "supported_projections",
  ]);
  const rows = [...values.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'::jsonb\s*,\s*'([^']+)'::jsonb\s*\)/gu)];
  assert.ok(rows.length > 0, "registry values must be explicit pinned identities");
  return rows.map(([, contract_id, contract_version, schema_hash, core_commit, commands, projections]) => ({
    contract_id, contract_version, schema_hash, core_commit,
    supported_commands: JSON.parse(commands),
    supported_projections: JSON.parse(projections),
  }));
}

test("local Core keeps its separately pinned mainline contract identity", () => {
  assert.equal(bridge.core_runtime.core_commit, localCoreCommit);
  assert.deepEqual(bridge.contract_identities.map((identity) => ({
    contract_id: identity.contract_id,
    contract_version: identity.contract_version,
    schema_hash: identity.schema_hash,
    supported_commands: identity.supported_commands,
    supported_projections: identity.supported_projections,
  })), [{
    contract_id: "edupi-bridge-v1.1",
    contract_version: "1.1",
    schema_hash: localBridgeSchema,
    supported_commands: deployedCommands,
    supported_projections: ["education_workspace"],
  }, {
    ...occurrenceIdentity,
    supported_commands: ["import_calendar"],
    supported_projections: ["schedule_occurrence"],
  }]);
});

test("cloud manifest and deployed migrations pin the old cloud writer rather than local Core", () => {
  const writerIdentity = {
    contract_id: "edupi-cloud-canonical-writer",
    contract_version: "1.0",
    schema_hash: cloudBridgeSchema,
    core_commit: cloudCoreCommit,
  };
  const cloudBridgeIdentity = {
    contract_id: "edupi-bridge-v1.1",
    contract_version: "1.1",
    schema_hash: cloudBridgeSchema,
  };
  assert.deepEqual(cloudWriter, {
    ...writerIdentity,
    supported_commands: deployedCommands,
    supported_projections: ["education_workspace", "education_fact_v1", "core_runtime"],
    bridge_contract: cloudBridgeIdentity,
    schedule_occurrence_contract: occurrenceIdentity,
    bounded_task_commands: ["create_task", "move_task_stage"],
  });
  assert.deepEqual(EDUPI_CLOUD_WRITER_CONTRACT, writerIdentity);
  assert.doesNotThrow(() => assertCloudWriterContract(writerIdentity));
  assert.notEqual(writerIdentity.core_commit, bridge.core_runtime.core_commit);
  assert.notEqual(writerIdentity.schema_hash, bridge.contract_identities[0].schema_hash);
  assert.deepEqual(contractRegistryRows(migration), [{
    ...cloudBridgeIdentity,
    core_commit: cloudCoreCommit,
    supported_commands: deployedCommands,
    supported_projections: ["education_workspace"],
  }, {
    ...occurrenceIdentity,
    core_commit: cloudCoreCommit,
    supported_commands: ["import_calendar"],
    supported_projections: ["schedule_occurrence"],
  }]);
  assert.deepEqual(contractRegistryRows(canonicalMigration), [{
    ...writerIdentity,
    supported_commands: deployedCommands,
    supported_projections: ["education_workspace", "education_fact_v1", "core_runtime"],
  }]);
});

test("cloud task builder matches the deployed admission guard and rejects the local schema", () => {
  const guardedValues = (field) => [...canonicalMigration.matchAll(
    new RegExp(`command_envelope->>'${field}'\\s*<>\\s*'([^']+)'`, "gu"),
  )].map((match) => match[1]);
  assert.deepEqual(guardedValues("contract_version"), ["1.1"]);
  assert.deepEqual(guardedValues("schema_hash"), [cloudBridgeSchema]);
  assert.match(canonicalMigration, new RegExp(`'schema_hash', '${cloudBridgeSchema}'`, "u"));
  const envelope = buildCloudTaskEnvelope({
    snapshotId: "cloud-snapshot-synthetic-1",
    command: {
      command_type: "create_task",
      source: {
        source_id: "desktop-synthetic-task-1",
        source_kind: "teacher_message",
        source_hash: `sha256:${"a".repeat(64)}`,
        evidence_ids: ["synthetic-evidence-1"],
      },
      task: { task_id: "synthetic-task-1", title: "测试普通任务", due_date: null, note: null },
    },
    requestId: "cloud-synthetic-request-1",
    idempotencyKey: "cloud-synthetic-request-1",
    issuedAt: "2026-11-22T10:00:00.000Z",
    messageId: "cloud-synthetic-message-1",
  });
  assert.equal(envelope.contract_version, guardedValues("contract_version")[0]);
  assert.equal(envelope.schema_hash, guardedValues("schema_hash")[0]);
  assert.doesNotThrow(() => assertCloudTaskEnvelope(envelope));
  assert.throws(() => assertCloudTaskEnvelope({ ...envelope, schema_hash: localBridgeSchema }),
    (error) => error?.code === "invalid_envelope");
});

test("existing deployed migrations retain their exact bytes", () => {
  for (const [source, hash] of [
    [migration, "ef0ffc147a3462189d58f5d477dbbd0bcc9b1e419551a6d595649e3d9ed998cb"],
    [canonicalMigration, "834db24071611f3eddcc9838f72569432808d77dae2e9915cdc5976654be5df1"],
    [spineMigration, "74c4ad78ff022563bfbdfe1926476873a9125ca5354fe6880f7b82bfee5ebada"],
    [mobileMigration, "d2f6265a838ae5ef8a5ad77b5a68032af358a710975a8d81965e1728e9365101"],
    [mobileContractMigration, "b5c65b8ad740a2637f329e6d298a4e86e500968b9f41b821370cbe66d08e0c46"],
  ]) assert.equal(crypto.createHash("sha256").update(source).digest("hex"), hash);
});

test("cloud request IDs preserve local string request semantics", () => {
  assert.match(migration, /request_id text not null/);
  assert.match(migration, /p_request_id text/);
  assert.match(studentFunction, /requestId\(request, body\)/);
  assert.match(classroomFunction, /requestId\(request, body\)/);
});

test("classroom mutations use the canonical writer", () => {
  for (const action of ["preview", "save", "restore", "publish"]) assert.match(classroomFunction, new RegExp(action));
  assert.match(classroomFunction, /mutate_classroom_object/);
  assert.doesNotMatch(classroomFunction, /core_required/);
});

test("canonical writer covers facts, tasks, materials, snapshots, and runtime fencing", () => {
  for (const marker of [
    "create table if not exists edupi.workspace_snapshots",
    "create table if not exists edupi.command_receipts",
    "create table if not exists edupi.tasks",
    "create table if not exists edupi.materials",
    "create table if not exists edupi.facts",
    "create table if not exists edupi.fact_spine_snapshots",
    "create table if not exists edupi.core_runtime_instances",
    "create table if not exists edupi.core_runtime_leases",
    "create or replace function edupi.apply_core_command",
    "create or replace function edupi.mutate_education_fact",
    "create or replace function edupi.capture_education_fact",
    "create or replace function edupi.mutate_material_metadata",
    "create or replace function edupi.runtime_transition",
  ]) assert.match(canonicalMigration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(brokerFunction, /operation === "command"/);
  assert.match(brokerFunction, /operation === "education-facts"/);
  assert.match(brokerFunction, /operation === "material-metadata"/);
  assert.match(runtimeFunction, /runtime_transition/);
});

test("cloud configuration has one entry per function and a private material bucket", () => {
  for (const name of ["edupi-student-events", "edupi-classroom", "edupi-core-broker", "edupi-core-runtime", "edupi-account", "edupi-materials"]) {
    assert.equal((config.match(new RegExp(`\\[functions\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "g")) || []).length, 1);
  }
  assert.match(config, /\[storage\.buckets\.edupi-materials\]/);
  assert.match(config, /public = false/);
  assert.match(accountFunction, /create_workspace/);
  assert.match(materialsFunction, /createSignedUploadUrl/);
});

test("fact spine replacement is idempotent and read paths use workspace RLS", () => {
  assert.match(spineMigration, /audit_events_fact_spine_request_idx/);
  assert.match(spineMigration, /idempotency_conflict/);
  assert.match(spineMigration, /replayed.*true/);
  assert.match(brokerFunction, /const FACT_KINDS/);
  assert.match(brokerFunction, /context\.db\s*\.from\("facts"\)/);
  assert.match(brokerFunction, /context\.db\s*\.from\("fact_spine_snapshots"\)/);
  assert.match(brokerFunction, /context\.db\s*\.from\("material_versions"\)/);
});

test("mobile dashboard is a versioned contract shared by broker, migration, and iOS", () => {
  const schemaHash = `sha256:${crypto.createHash("sha256").update(JSON.stringify(mobileContract, null, 2) + "\n").digest("hex")}`;
  assert.equal(mobileContract.contract_id, "edupi-mobile-dashboard-v1");
  assert.equal(mobileContract.contract_version, "1.0");
  assert.equal(schemaHash, "sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8");
  assert.deepEqual(EDUPI_MOBILE_DASHBOARD_CONTRACT, {
    contract_id: "edupi-mobile-dashboard-v1", contract_version: "1.0", schema_hash: schemaHash,
  });
  assert.deepEqual(contractRegistryRows(mobileContractMigration), [{
    contract_id: "edupi-mobile-dashboard-v1", contract_version: "1.0", schema_hash: schemaHash,
    core_commit: cloudCoreCommit, supported_commands: [], supported_projections: ["mobile_dashboard"],
  }]);
  assert.match(mobileMigration, /mobile_dashboard_payload/);
  assert.match(mobileContractMigration, new RegExp(schemaHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(brokerFunction, /mobile-dashboard/);
  assert.match(brokerFunction, new RegExp(schemaHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(mobileAPI, /edupi-mobile-dashboard-v1/);
  assert.match(mobileAPI, new RegExp(schemaHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
