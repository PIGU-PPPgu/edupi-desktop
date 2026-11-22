import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EDUPI_CLOUD_WRITER_CONTRACT,
  EDUPI_CLOUD_BRIDGE_CONTRACT,
  assertCloudWriterContract,
  assertCloudTaskEnvelope,
  buildCloudTaskEnvelope,
} from "./edupi-cloud-writer-contract.ts";

const cloudSchema = "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8";
const localSchema = "sha256:4d406ea05466f525d68e9a5c2e8f21b05a1013346fff5962a3ccc0ea61398b1d";
const cloudCommit = "3ce22b1e08804aa36dccf59d76a8e61b15f2c462";

function createCommand() {
  return {
    command_type: "create_task",
    source: {
      source_id: "desktop-task-create-synthetic-1",
      source_kind: "teacher_message",
      source_hash: `sha256:${"a".repeat(64)}`,
      evidence_ids: ["evidence-synthetic-1"],
    },
    task: {
      task_id: "teacher-task-synthetic-1",
      title: "准备单元检测",
      due_date: "2026-11-23",
      note: "先整理范围",
      preparation_source: null,
    },
  };
}

function moveCommand() {
  return {
    command_type: "move_task_stage",
    source: createCommand().source,
    task_id: "teacher-task-synthetic-1",
    expected_revision: 2,
    to_stage: "progress",
    note: null,
  };
}

function options(command = createCommand()) {
  return {
    snapshotId: "snapshot-before",
    command,
    requestId: "create-synthetic-1",
    idempotencyKey: "create-synthetic-1",
    issuedAt: "2026-11-22T10:00:00.000Z",
    messageId: "cloud-message-synthetic-1",
  };
}

function rejectsEnvelope(action, label) {
  assert.throws(action, (error) => error?.code === "invalid_envelope", label);
}

test("pins a cloud writer identity independently of the local Core", async () => {
  const manifest = JSON.parse(await readFile(new URL("../contracts/edupi-cloud-writer-v1.json", import.meta.url), "utf8"));
  const expected = {
    contract_id: "edupi-cloud-canonical-writer",
    contract_version: "1.0",
    schema_hash: cloudSchema,
    core_commit: cloudCommit,
  };
  assert.deepEqual(EDUPI_CLOUD_WRITER_CONTRACT, expected);
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map((key) => [key, manifest[key]])), expected);
  assert.deepEqual(EDUPI_CLOUD_BRIDGE_CONTRACT, {
    contract_id: "edupi-bridge-v1.1",
    contract_version: "1.1",
    schema_hash: cloudSchema,
  });
  assert.deepEqual(manifest.bridge_contract, EDUPI_CLOUD_BRIDGE_CONTRACT);
  assert.deepEqual(manifest.bounded_task_commands, ["create_task", "move_task_stage"]);
  assert.doesNotThrow(() => assertCloudWriterContract(expected));
  for (const invalid of [
    null, [], "cloud",
    { ...expected, contract_id: "edupi-bridge-v1.1" },
    { ...expected, contract_version: "1.1" },
    { ...expected, schema_hash: localSchema },
    { ...expected, schema_hash: `sha256:${"0".repeat(64)}` },
    { ...expected, core_commit: "fc89b3bc899a55b0fdad61b8f37e238d950f37c6" },
    { ...expected, core_commit: undefined },
  ]) {
    assert.throws(() => assertCloudWriterContract(invalid), (error) => error?.code === "unsupported_contract");
  }
});

test("builds the complete source-bound cloud create envelope with the deployed schema", () => {
  const input = options();
  const envelope = buildCloudTaskEnvelope(input);
  assert.deepEqual(envelope, {
    contract_version: "1.1",
    message_id: input.messageId,
    request_id: input.requestId,
    issued_at: input.issuedAt,
    producer: "edupi-desktop",
    schema_hash: cloudSchema,
    snapshot_id: input.snapshotId,
    idempotency_key: input.idempotencyKey,
    provenance: [{
      source_kind: "teacher_message",
      source_id: input.command.source.source_id,
      source_path: null,
      source_hash: input.command.source.source_hash,
      observed_at: input.issuedAt,
      actor: "teacher",
      evidence_ids: ["evidence-synthetic-1"],
      parent_ids: [],
    }],
    teacher_review: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
    external_send: false,
    command: input.command,
  });
  assert.notEqual(envelope.schema_hash, localSchema);
  assert.doesNotThrow(() => assertCloudTaskEnvelope(JSON.parse(JSON.stringify(envelope))));
});

test("binds move commands to the expected revision and all four supported stages", () => {
  for (const stage of ["todo", "progress", "review", "done"]) {
    const command = { ...moveCommand(), to_stage: stage };
    const envelope = buildCloudTaskEnvelope(options(command));
    assert.deepEqual(envelope.command, command);
    assert.equal(envelope.teacher_review.revision, 2);
    assert.doesNotThrow(() => assertCloudTaskEnvelope(envelope));
  }
});

test("defaults only message ID and issue time while preserving string request IDs", () => {
  const input = options();
  delete input.messageId;
  delete input.issuedAt;
  input.requestId = "teacher:request-1";
  input.idempotencyKey = `sha256:${"b".repeat(64)}`;
  const envelope = buildCloudTaskEnvelope(input);
  assert.match(envelope.message_id, /^cloud-task-message-[0-9a-f-]{36}$/u);
  assert.equal(new Date(envelope.issued_at).toISOString(), envelope.issued_at);
  assert.equal(envelope.provenance[0].observed_at, envelope.issued_at);
  assert.equal(envelope.request_id, input.requestId);
  assert.equal(envelope.idempotency_key, input.idempotencyKey);
  for (const key of ["requestId", "idempotencyKey", "snapshotId"]) {
    const missing = { ...input };
    delete missing[key];
    rejectsEnvelope(() => buildCloudTaskEnvelope(missing), key);
  }
});

test("rejects every command outside the bounded task writer even if Core supports it", () => {
  for (const commandType of ["unknown", "review_task", "import_calendar", "intake_material", "update_memory", "", null]) {
    assert.throws(
      () => buildCloudTaskEnvelope(options({ ...createCommand(), command_type: commandType })),
      (error) => error?.code === "unsupported_command",
      String(commandType),
    );
  }
});

test("accepts simple task null markers and refuses preparation or recurring behavior", () => {
  const command = createCommand();
  delete command.task.preparation_source;
  assert.doesNotThrow(() => buildCloudTaskEnvelope(options(command)));
  command.task.preparation_source = null;
  command.task.recurrence = null;
  assert.doesNotThrow(() => buildCloudTaskEnvelope(options(command)));
  for (const [field, value] of [
    ["preparation_source", { kind: "teaching_before_class", timetable_slot_id: "slot-1", lesson_date: "2026-11-23", material_ids: ["material-1"], deliverables: ["教案"] }],
    ["recurrence", { kind: "teacher_internal_materials", cadence: "weekly", until_date: "2026-12-01", lead_days: 2, deliverables: ["周报"] }],
  ]) {
    const invalid = createCommand();
    invalid.task[field] = value;
    rejectsEnvelope(() => buildCloudTaskEnvelope(options(invalid)), field);
  }
});

test("refuses unknown fields at each input boundary instead of silently dropping them", () => {
  for (const field of ["schema_hash", "external_send", "provenance", "reviewerId", "localPath"]) {
    rejectsEnvelope(() => buildCloudTaskEnvelope({ ...options(), [field]: "/Users/synthetic/private" }), field);
  }
  for (const location of ["command", "source", "task"]) {
    for (const field of ["source_path", "path", "storage_object_key", "external_send", "toJSON"]) {
      const command = createCommand();
      const target = location === "command" ? command : command[location];
      target[field] = "/Users/synthetic/private";
      rejectsEnvelope(() => buildCloudTaskEnvelope(options(command)), `${location}.${field}`);
    }
  }
  const move = { ...moveCommand(), task: createCommand().task };
  rejectsEnvelope(() => buildCloudTaskEnvelope(options(move)), "move with create-only fields");
});

test("refuses missing objects and non-JSON object hooks", () => {
  for (const value of [null, [], "command", {}]) {
    rejectsEnvelope(() => buildCloudTaskEnvelope(value), "options");
    rejectsEnvelope(() => buildCloudTaskEnvelope(options(value)), "command");
  }
  for (const key of ["task", "source"]) {
    const command = createCommand();
    command[key] = Object.assign(Object.create({ toJSON: () => "/Users/synthetic/private" }), command[key]);
    rejectsEnvelope(() => buildCloudTaskEnvelope(options(command)), key);
  }
});

test("rejects local paths in text, source IDs, evidence IDs, and envelope IDs", () => {
  const paths = [
    "/Users/synthetic/private/lesson.md",
    "请读取 /tmp/synthetic/lesson.md",
    "路径：/Users/synthetic/private/lesson.md",
    "文件在/Users/synthetic/private/lesson.md",
    "请读取 `/Users/synthetic/private/lesson.md`",
    "请读取“/Users/synthetic/private/lesson.md”",
    "path:/tmp/synthetic/lesson.md",
    "//synthetic-server/private/lesson.md",
    "~/private/lesson.md",
    "../private/lesson.md",
    "./private/lesson.md",
    "C:\\Users\\synthetic\\lesson.md",
    "C:/Users/synthetic/lesson.md",
    "\\\\synthetic-server\\private\\lesson.md",
    "file:///Users/synthetic/private/lesson.md",
  ];
  for (const path of paths) {
    for (const field of ["title", "note", "task_id"]) {
      const command = createCommand();
      command.task[field] = path;
      rejectsEnvelope(() => buildCloudTaskEnvelope(options(command)), `task.${field}: ${path}`);
    }
    for (const field of ["source_id", "evidence_ids"]) {
      const command = createCommand();
      command.source[field] = field === "evidence_ids" ? [path] : path;
      rejectsEnvelope(() => buildCloudTaskEnvelope(options(command)), `source.${field}: ${path}`);
    }
    for (const field of ["requestId", "idempotencyKey", "snapshotId", "messageId"]) {
      rejectsEnvelope(() => buildCloudTaskEnvelope({ ...options(), [field]: path }), field);
    }
    const move = { ...moveCommand(), note: path };
    rejectsEnvelope(() => buildCloudTaskEnvelope(options(move)), "move note");
  }
  const normal = createCommand();
  normal.task.note = "比较 1/2 与 1/3\n参考 https://example.invalid/math";
  assert.doesNotThrow(() => buildCloudTaskEnvelope(options(normal)));
});

test("bounds envelope IDs and requires an actual UTC issue timestamp", () => {
  for (const field of ["snapshotId", "requestId", "idempotencyKey", "messageId"]) {
    for (const value of ["", " ", "a".repeat(161), "synthetic\nid", 123, null]) {
      rejectsEnvelope(() => buildCloudTaskEnvelope({ ...options(), [field]: value }), field);
    }
  }
  for (const issuedAt of ["", "yesterday", "2026-02-30T10:00:00.000Z", "2026-11-22T25:00:00.000Z", null]) {
    rejectsEnvelope(() => buildCloudTaskEnvelope({ ...options(), issuedAt }), "issuedAt");
  }
});

test("bounds task dates, title, and notes without coercing malformed values", () => {
  for (const [field, values] of [
    ["task_id", ["", "a".repeat(161), 1, null]],
    ["title", ["", " ", "a".repeat(241), 1, null]],
    ["due_date", ["", "2026-02-30", "2026-13-01", "2026-1-01", 1, undefined]],
    ["note", ["a".repeat(1001), {}, 1, undefined]],
  ]) {
    for (const value of values) {
      const command = createCommand();
      command.task[field] = value;
      rejectsEnvelope(() => buildCloudTaskEnvelope(options(command)), field);
    }
  }
  const valid = createCommand();
  valid.task.title = "a".repeat(240);
  valid.task.note = "b".repeat(1000);
  valid.task.due_date = "2028-02-29";
  assert.doesNotThrow(() => buildCloudTaskEnvelope(options(valid)));
  valid.task.due_date = null;
  valid.task.note = null;
  assert.doesNotThrow(() => buildCloudTaskEnvelope(options(valid)));
});

test("bounds teacher-message provenance and evidence before it can be serialized", () => {
  for (const [field, values] of [
    ["source_id", ["", 1]],
    ["source_kind", ["teacher_file", "core_event", null]],
    ["source_hash", ["sha256:short", `sha256:${"z".repeat(64)}`, null]],
    ["evidence_ids", [null, "evidence-1", [""], [1], Array(51).fill("evidence-1")]],
  ]) {
    for (const value of values) {
      const command = createCommand();
      command.source[field] = value;
      rejectsEnvelope(() => buildCloudTaskEnvelope(options(command)), field);
    }
  }
  const valid = createCommand();
  valid.source.evidence_ids = Array(50).fill("evidence-1");
  assert.doesNotThrow(() => buildCloudTaskEnvelope(options(valid)));
});

test("refuses invalid stages and revisions that cannot be incremented by Postgres", () => {
  for (const toStage of ["accepted", "complete", "", null]) {
    rejectsEnvelope(() => buildCloudTaskEnvelope(options({ ...moveCommand(), to_stage: toStage })), "stage");
  }
  for (const revision of [-1, 0.5, "2", null, NaN, Infinity, 2147483647]) {
    rejectsEnvelope(() => buildCloudTaskEnvelope(options({ ...moveCommand(), expected_revision: revision })), "revision");
  }
});

test("rejects a local or unknown schema and any changed envelope safety binding", () => {
  const mutations = [
    (e) => { e.schema_hash = localSchema; },
    (e) => { e.schema_hash = `sha256:${"0".repeat(64)}`; },
    (e) => { e.contract_version = "1.0"; },
    (e) => { e.producer = "edupi-core"; },
    (e) => { e.external_send = true; },
    (e) => { e.provenance[0].source_path = "/Users/synthetic/private"; },
    (e) => { e.provenance[0].source_id = "different-source"; },
    (e) => { e.provenance[0].source_hash = `sha256:${"b".repeat(64)}`; },
    (e) => { e.provenance[0].evidence_ids = ["different-evidence"]; },
    (e) => { e.provenance[0].observed_at = "2026-11-23T10:00:00.000Z"; },
    (e) => { e.provenance[0].parent_ids = ["other-parent"]; },
    (e) => { e.teacher_review.state = "accepted"; },
    (e) => { e.teacher_review.reviewer_id = "teacher"; },
    (e) => { e.teacher_review.revision = 1; },
    (e) => { e.path = "/Users/synthetic/private"; },
    (e) => { delete e.idempotency_key; },
  ];
  for (const mutate of mutations) {
    const envelope = buildCloudTaskEnvelope(options());
    mutate(envelope);
    rejectsEnvelope(() => assertCloudTaskEnvelope(envelope), mutate.toString());
  }
  const unknownCommand = buildCloudTaskEnvelope(options());
  unknownCommand.command.command_type = "update_memory";
  assert.throws(() => assertCloudTaskEnvelope(unknownCommand), (error) => error?.code === "unsupported_command");
});

test("returns a detached command so later caller edits cannot leak local paths", () => {
  const input = options();
  const envelope = buildCloudTaskEnvelope(input);
  input.command.task.note = "/Users/synthetic/private";
  input.command.source.evidence_ids.push("C:\\Users\\synthetic\\private");
  assert.equal(envelope.command.task.note, "先整理范围");
  assert.deepEqual(envelope.command.source.evidence_ids, ["evidence-synthetic-1"]);
  assert.deepEqual(envelope.provenance[0].evidence_ids, ["evidence-synthetic-1"]);
  assert.doesNotThrow(() => assertCloudTaskEnvelope(envelope));
});

test("rebuilds the same envelope only when the caller also preserves message ID and issue time", () => {
  const input = options();
  assert.deepEqual(buildCloudTaskEnvelope(input), buildCloudTaskEnvelope(input));
});

test("does not load local Core contracts or builders", async () => {
  const source = await readFile(new URL("./edupi-cloud-writer-contract.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ["../contracts/edupi-cloud-writer-v1.json", "node:crypto"]);
});
