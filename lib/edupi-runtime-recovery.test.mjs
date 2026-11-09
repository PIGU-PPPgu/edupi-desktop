import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, existsSync, unlinkSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const { inspectEduPiRuntimeRecovery, repairEduPiRuntimeState } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-runtime-recovery.ts");

const runtimeSchema = `
CREATE TABLE runtime_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE authority (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1), schema_version INTEGER NOT NULL,
  root_fingerprint TEXT NOT NULL, fencing_generation INTEGER NOT NULL CHECK (fencing_generation >= 1),
  owner_pid INTEGER NOT NULL CHECK (owner_pid >= 1), process_start_evidence TEXT NOT NULL,
  instance_nonce TEXT NOT NULL, supervisor_session_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('starting','ready','degraded','draining','failed','stopped')),
  acquired_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE events (
  event_id TEXT PRIMARY KEY NOT NULL, event_version INTEGER NOT NULL CHECK (event_version = 1),
  event_type TEXT NOT NULL CHECK (event_type IN ('teacher_event','timer_event')), occurrence_time TEXT NOT NULL,
  source_ref TEXT NOT NULL, actor_ref TEXT NOT NULL, scope_ref TEXT NOT NULL, revision_ref TEXT NOT NULL,
  payload_json TEXT NOT NULL, canonical_json TEXT NOT NULL, canonical_hash TEXT NOT NULL,
  external_send INTEGER NOT NULL CHECK (external_send = 0),
  state TEXT NOT NULL CHECK (state IN ('queued','claimed','completed','failed','cancelled')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0 AND attempts <= 3),
  fencing_generation INTEGER NOT NULL CHECK (fencing_generation >= 1), claim_token_hash TEXT, claimed_at TEXT,
  claim_deadline TEXT, deferred INTEGER NOT NULL DEFAULT 0 CHECK (deferred IN (0,1)), deferred_reason TEXT,
  result_code TEXT, settlement_kind TEXT, settlement_code TEXT, settlement_generation INTEGER,
  settlement_token_hash TEXT, settlement_deadline TEXT,
  settlement_retryable INTEGER NOT NULL DEFAULT 0 CHECK (settlement_retryable IN (0,1)),
  receipt_promotion_ack INTEGER NOT NULL DEFAULT 1 CHECK (receipt_promotion_ack IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (state <> 'queued' OR attempts < 3), CHECK (state <> 'claimed' OR attempts >= 1),
  CHECK ((deferred = 0 AND deferred_reason IS NULL) OR (deferred = 1 AND state = 'claimed' AND deferred_reason = 'invalidation_pending'))
) STRICT;
CREATE INDEX events_available_idx ON events(state, occurrence_time, created_at, event_id);
CREATE INDEX events_terminal_idx ON events(state, updated_at, event_id);
PRAGMA user_version = 1;
`;

const admissionSchema = `
CREATE TABLE admission_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE admission_lease (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  admission_version INTEGER NOT NULL CHECK (admission_version = 1), root_fingerprint TEXT NOT NULL,
  lease_kind TEXT NOT NULL, owner_pid INTEGER NOT NULL CHECK (owner_pid >= 1),
  process_start_evidence TEXT NOT NULL, lease_id TEXT NOT NULL, acquired_at TEXT NOT NULL
) STRICT;
PRAGMA user_version = 1;
`;

const runtimeV4Extensions = `
CREATE TABLE owner_history_v3_record (
  message_ref TEXT PRIMARY KEY NOT NULL CHECK (
    length(message_ref) = 78
    AND length(CAST(message_ref AS BLOB)) = 78
    AND instr(message_ref, char(0)) = 0
    AND substr(message_ref, 1, 14) = 'owner_message:'
    AND substr(message_ref, 15) NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('registered','captured','withdrawn','sealed_absent')),
  registration_sequence INTEGER UNIQUE CHECK (registration_sequence > 0),
  last_action_sequence INTEGER NOT NULL UNIQUE CHECK (last_action_sequence > 0),
  carrier_plan_blind BLOB UNIQUE CHECK (carrier_plan_blind IS NULL OR length(carrier_plan_blind) = 32),
  source_blind BLOB NOT NULL CHECK (length(source_blind) = 32),
  grant_blind BLOB NOT NULL CHECK (length(grant_blind) = 32),
  payload_cipher BLOB NOT NULL CHECK (length(payload_cipher) BETWEEN 1 AND 65536),
  payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 12),
  payload_tag BLOB NOT NULL CHECK (length(payload_tag) = 16),
  payload_mac BLOB NOT NULL CHECK (length(payload_mac) = 32),
  CHECK (status NOT IN ('registered','sealed_absent') OR registration_sequence IS NOT NULL),
  CHECK ((registration_sequence IS NULL) = (carrier_plan_blind IS NULL))
) STRICT;
CREATE INDEX owner_history_v3_source_idx
  ON owner_history_v3_record (source_blind, last_action_sequence);
CREATE INDEX owner_history_v3_grant_idx
  ON owner_history_v3_record (grant_blind, last_action_sequence);
CREATE TABLE owner_history_v3_action (
  sequence INTEGER PRIMARY KEY NOT NULL CHECK (sequence > 0),
  message_ref TEXT NOT NULL REFERENCES owner_history_v3_record(message_ref),
  action TEXT NOT NULL CHECK (action IN ('register','capture','seal','withdraw')),
  payload_cipher BLOB NOT NULL CHECK (length(payload_cipher) BETWEEN 1 AND 65536),
  payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 12),
  payload_tag BLOB NOT NULL CHECK (length(payload_tag) = 16),
  payload_mac BLOB NOT NULL CHECK (length(payload_mac) = 32)
) STRICT;
CREATE INDEX owner_history_v3_action_ref_idx
  ON owner_history_v3_action (message_ref, sequence);
CREATE TABLE planning_v2_history (
  sequence INTEGER PRIMARY KEY NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  version INTEGER NOT NULL CHECK (version IN (1, 2)),
  record_kind TEXT NOT NULL CHECK (
    record_kind IN ('event', 'goal_command', 'decision', 'transaction_begin', 'transaction_end')
  ),
  ordinal INTEGER CHECK (ordinal BETWEEN 0 AND 9007199254740991),
  transaction_id TEXT CHECK (transaction_id IS NULL OR (
    length(CAST(transaction_id AS BLOB)) = 44 AND length(transaction_id) = 44
    AND substr(transaction_id, 1, 12) = 'planning_tx_'
    AND substr(transaction_id, 13) NOT GLOB '*[^0-9a-f]*'
  )),
  resulting_generation INTEGER CHECK (resulting_generation BETWEEN 2 AND 9007199254740991),
  transaction_operation_index INTEGER CHECK (transaction_operation_index BETWEEN 0 AND 15),
  recorded_at TEXT NOT NULL CHECK (
    length(recorded_at) = 24 AND length(CAST(recorded_at AS BLOB)) = 24
    AND strftime('%Y-%m-%dT%H:%M:%fZ', recorded_at) IS recorded_at
  ),
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json) AND json_type(canonical_json) = 'object'),
  previous_hash TEXT NOT NULL CHECK (
    length(previous_hash) = 71 AND length(CAST(previous_hash AS BLOB)) = 71
    AND substr(previous_hash, 1, 7) = 'sha256:'
    AND substr(previous_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  record_hash TEXT NOT NULL UNIQUE CHECK (
    length(record_hash) = 71 AND length(CAST(record_hash AS BLOB)) = 71
    AND substr(record_hash, 1, 7) = 'sha256:'
    AND substr(record_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  previous_sequence INTEGER GENERATED ALWAYS AS (nullif(sequence - 1, 0)) STORED,
  event_id TEXT GENERATED ALWAYS AS (
    CASE WHEN record_kind = 'event' THEN json_extract(canonical_json, '$.id') END
  ) STORED UNIQUE,
  source_id TEXT GENERATED ALWAYS AS (
    CASE WHEN record_kind = 'event' THEN json_extract(canonical_json, '$.source_id') END
  ) STORED,
  source_revision INTEGER GENERATED ALWAYS AS (
    CASE WHEN record_kind = 'event' THEN json_extract(canonical_json, '$.revision') END
  ) STORED,
  goal_id TEXT GENERATED ALWAYS AS (
    CASE WHEN record_kind = 'event' THEN json_extract(canonical_json, '$.payload.goal_id')
      WHEN record_kind IN ('goal_command', 'decision') THEN json_extract(canonical_json, '$.goal_id') END
  ) STORED,
  goal_version INTEGER GENERATED ALWAYS AS (
    CASE WHEN record_kind = 'goal_command' THEN json_extract(canonical_json, '$.resulting_version') END
  ) STORED,
  lesson_id TEXT GENERATED ALWAYS AS (
    CASE WHEN record_kind = 'decision' THEN json_extract(canonical_json, '$.lesson_id') END
  ) STORED,
  CHECK ((version = 1 AND ordinal IS NOT NULL AND transaction_id IS NULL
    AND resulting_generation IS NULL AND transaction_operation_index IS NULL
    AND record_kind IN ('event', 'goal_command', 'decision'))
    OR (version = 2 AND ordinal IS NULL AND transaction_id IS NOT NULL
      AND resulting_generation IS NOT NULL
      AND ((record_kind IN ('transaction_begin', 'transaction_end') AND transaction_operation_index IS NULL)
        OR (record_kind IN ('event', 'goal_command', 'decision') AND transaction_operation_index IS NOT NULL)))),
  CHECK (sequence <> 1 OR previous_hash =
    'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
  CHECK (record_kind <> 'event' OR (
    json_type(canonical_json, '$.id') IS 'text' AND length(event_id) BETWEEN 1 AND 128
    AND instr(event_id, char(0)) = 0 AND event_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    AND json_type(canonical_json, '$.source_id') IS 'text' AND length(source_id) BETWEEN 1 AND 128
    AND instr(source_id, char(0)) = 0 AND source_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    AND json_type(canonical_json, '$.revision') IS 'integer'
    AND source_revision BETWEEN 1 AND 9007199254740991
  )),
  CHECK (goal_id IS NULL OR (
    length(goal_id) BETWEEN 1 AND 128 AND instr(goal_id, char(0)) = 0
    AND goal_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
  )),
  CHECK (record_kind <> 'event' OR json_type(canonical_json, '$.payload.goal_id') IS NULL
    OR json_type(canonical_json, '$.payload.goal_id') IS 'text'),
  CHECK (record_kind <> 'goal_command' OR (
    json_type(canonical_json, '$.goal_id') IS 'text' AND goal_id IS NOT NULL
    AND json_type(canonical_json, '$.resulting_version') IS 'integer'
    AND goal_version BETWEEN 1 AND 9007199254740991
  )),
  CHECK (record_kind <> 'decision' OR (
    json_type(canonical_json, '$.goal_id') IS 'text' AND goal_id IS NOT NULL
    AND json_type(canonical_json, '$.lesson_id') IS 'text' AND length(lesson_id) BETWEEN 1 AND 128
    AND instr(lesson_id, char(0)) = 0 AND lesson_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
  )),
  UNIQUE (sequence, record_hash),
  UNIQUE (sequence, source_id, source_revision),
  UNIQUE (sequence, goal_id, goal_version),
  UNIQUE (sequence, goal_id, lesson_id),
  UNIQUE (sequence, event_id, source_id, source_revision),
  FOREIGN KEY (previous_sequence, previous_hash) REFERENCES planning_v2_history(sequence, record_hash)
) STRICT;
CREATE UNIQUE INDEX planning_v2_history_migration_ordinal_idx
  ON planning_v2_history(record_kind, ordinal) WHERE version = 1;
CREATE UNIQUE INDEX planning_v2_history_goal_version_idx
  ON planning_v2_history(goal_id, goal_version) WHERE record_kind = 'goal_command';
CREATE INDEX planning_v2_history_source_revision_idx
  ON planning_v2_history(source_id, source_revision, sequence);
CREATE INDEX planning_v2_history_goal_cursor_idx
  ON planning_v2_history(goal_id, sequence);
CREATE INDEX planning_v2_history_decision_cursor_idx
  ON planning_v2_history(goal_id, lesson_id, sequence) WHERE record_kind = 'decision';
CREATE INDEX planning_v2_history_time_cursor_idx
  ON planning_v2_history(recorded_at, sequence);
CREATE INDEX planning_v2_history_kind_cursor_idx
  ON planning_v2_history(record_kind, sequence);
CREATE INDEX planning_v2_history_transaction_idx
  ON planning_v2_history(transaction_id, sequence) WHERE version = 2;
CREATE INDEX planning_v2_history_student_cursor_idx
  ON planning_v2_history(sequence)
  WHERE record_kind = 'event' AND json_extract(canonical_json, '$.kind') = 'student';
CREATE INDEX planning_v2_history_student_scope_idx
  ON planning_v2_history(json_extract(canonical_json, '$.scope.class_id'),
    json_extract(canonical_json, '$.scope.subject'),
    json_extract(canonical_json, '$.payload.student_id'), sequence)
  WHERE record_kind = 'event' AND json_extract(canonical_json, '$.kind') = 'student';
CREATE TRIGGER planning_v2_history_no_update
  BEFORE UPDATE ON planning_v2_history BEGIN SELECT RAISE(ABORT, 'planning_v2_history_immutable'); END;
CREATE TRIGGER planning_v2_history_no_delete
  BEFORE DELETE ON planning_v2_history BEGIN SELECT RAISE(ABORT, 'planning_v2_history_immutable'); END;
CREATE TRIGGER planning_v2_history_no_replace
  BEFORE INSERT ON planning_v2_history
  WHEN EXISTS (SELECT 1 FROM planning_v2_history WHERE sequence = NEW.sequence OR record_hash = NEW.record_hash
    OR event_id = NEW.event_id
    OR (version = 1 AND NEW.version = 1 AND record_kind = NEW.record_kind AND ordinal = NEW.ordinal)
    OR (record_kind = 'goal_command' AND NEW.record_kind = 'goal_command'
      AND goal_id = NEW.goal_id AND goal_version = NEW.goal_version))
  BEGIN SELECT RAISE(ABORT, 'planning_v2_history_immutable'); END;
CREATE TABLE planning_v2_source_head (
  source_id TEXT PRIMARY KEY NOT NULL,
  latest_revision INTEGER NOT NULL CHECK (latest_revision BETWEEN 1 AND 9007199254740991),
  latest_sequence INTEGER NOT NULL,
  previous_sequence INTEGER,
  previous_revision INTEGER GENERATED ALWAYS AS (
    CASE WHEN previous_sequence IS NOT NULL THEN latest_revision - 1 END
  ) STORED,
  CHECK (previous_sequence IS NULL OR latest_revision > 1),
  FOREIGN KEY (latest_sequence, source_id, latest_revision)
    REFERENCES planning_v2_history(sequence, source_id, source_revision),
  FOREIGN KEY (previous_sequence, source_id, previous_revision)
    REFERENCES planning_v2_history(sequence, source_id, source_revision)
) STRICT;
CREATE TABLE planning_v2_goal_head (
  goal_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked', 'expired')),
  latest_sequence INTEGER NOT NULL,
  spec_hash TEXT NOT NULL CHECK (
    length(spec_hash) = 71 AND length(CAST(spec_hash AS BLOB)) = 71
    AND substr(spec_hash, 1, 7) = 'sha256:' AND substr(spec_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  FOREIGN KEY (latest_sequence, goal_id, version)
    REFERENCES planning_v2_history(sequence, goal_id, goal_version)
) STRICT;
CREATE TABLE planning_v2_decision_head (
  goal_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  latest_sequence INTEGER NOT NULL,
  PRIMARY KEY (goal_id, lesson_id),
  FOREIGN KEY (latest_sequence, goal_id, lesson_id)
    REFERENCES planning_v2_history(sequence, goal_id, lesson_id)
) STRICT;
CREATE TABLE planning_v2_review_head (
  lineage_key TEXT PRIMARY KEY NOT NULL CHECK (
    length(lineage_key) = 46 AND length(CAST(lineage_key AS BLOB)) = 46
    AND substr(lineage_key, 1, 14) = 'parent_review_'
    AND substr(lineage_key, 15) NOT GLOB '*[^0-9a-f]*'
  ),
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  latest_sequence INTEGER NOT NULL,
  FOREIGN KEY (latest_sequence, event_id, source_id, revision)
    REFERENCES planning_v2_history(sequence, event_id, source_id, source_revision)
) STRICT;
CREATE TABLE planning_v2_checkpoint (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 2),
  generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  history_tip_sequence INTEGER NOT NULL CHECK (history_tip_sequence BETWEEN 0 AND 9007199254740991),
  history_tip_hash TEXT NOT NULL CHECK (
    length(history_tip_hash) = 71 AND length(CAST(history_tip_hash AS BLOB)) = 71
    AND substr(history_tip_hash, 1, 7) = 'sha256:' AND substr(history_tip_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_state_hash TEXT NOT NULL CHECK (
    length(source_state_hash) = 71 AND length(CAST(source_state_hash AS BLOB)) = 71
    AND substr(source_state_hash, 1, 7) = 'sha256:' AND substr(source_state_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  current_state_hash TEXT NOT NULL CHECK (
    length(current_state_hash) = 71 AND length(CAST(current_state_hash AS BLOB)) = 71
    AND substr(current_state_hash, 1, 7) = 'sha256:' AND substr(current_state_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  canonical_json TEXT NOT NULL CHECK (
    length(CAST(canonical_json AS BLOB)) <= 4194304
    AND json_valid(canonical_json) AND json_type(canonical_json) = 'object'
  ),
  tip_sequence_ref INTEGER GENERATED ALWAYS AS (nullif(history_tip_sequence, 0)) STORED,
  CHECK (history_tip_sequence <> 0 OR history_tip_hash =
    'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
  CHECK (json_type(canonical_json, '$.version') IS 'integer'
    AND json_extract(canonical_json, '$.version') IS version
    AND json_type(canonical_json, '$.generation') IS 'integer'
    AND json_extract(canonical_json, '$.generation') IS generation
    AND json_type(canonical_json, '$.history_tip_sequence') IS 'integer'
    AND json_extract(canonical_json, '$.history_tip_sequence') IS history_tip_sequence
    AND json_extract(canonical_json, '$.history_tip_hash') IS history_tip_hash
    AND json_extract(canonical_json, '$.source_state_hash') IS source_state_hash
    AND json_extract(canonical_json, '$.current_state_hash') IS current_state_hash
    AND json_type(canonical_json, '$.goals') IS 'array'
    AND json_type(canonical_json, '$.current_opportunities') IS 'array'
    AND json_type(canonical_json, '$.current_decisions') IS 'array'),
  FOREIGN KEY (tip_sequence_ref, history_tip_hash) REFERENCES planning_v2_history(sequence, record_hash)
) STRICT;
`;

const testRoots = [];
after(() => {
  for (const root of testRoots) rmSync(root, { recursive: true, force: true });
});

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "edupi-runtime-recovery-"));
  testRoots.push(root);
  const runtime = path.join(root, ".edupi", "runtime");
  mkdirSync(runtime, { recursive: true });
  const dataRoot = { root, memoryDir: path.join(root, ".edupi", "memory"), outputDir: path.join(root, ".edupi", "output"), lockDir: path.join(root, ".edupi", "locks") };
  for (const dir of [dataRoot.memoryDir, dataRoot.outputDir, dataRoot.lockDir]) mkdirSync(dir, { recursive: true });
  const runtimeDb = new DatabaseSync(path.join(runtime, "core-runtime-v1.sqlite"));
  runtimeDb.exec(runtimeSchema);
  runtimeDb.prepare("INSERT INTO runtime_meta VALUES ('schema_version', '1'), ('root_fingerprint', ?)").run("sha256:" + "1".repeat(64));
  runtimeDb.prepare("INSERT INTO authority VALUES (1, 1, ?, 1, 999999, 'p-test', 'nonce-test', 'session-test', 'stopped', '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z')").run("sha256:" + "1".repeat(64));
  runtimeDb.close();
  const admissionDb = new DatabaseSync(path.join(runtime, "core-runtime-writer-admission-v1.sqlite"));
  admissionDb.exec(admissionSchema);
  admissionDb.prepare("INSERT INTO admission_meta VALUES ('admission_version', '1'), ('root_fingerprint', ?)").run("sha256:" + "1".repeat(64));
  admissionDb.close();
  return dataRoot;
}

const current = "sha256:" + "2".repeat(64);

function upgradeFixtureToV4(dataRoot, fingerprint = current, ownerPid = 999999) {
  const directory = path.join(dataRoot.root, ".edupi", "runtime");
  const runtime = new DatabaseSync(path.join(directory, "core-runtime-v1.sqlite"));
  try {
    runtime.exec(runtimeV4Extensions);
    runtime.exec("PRAGMA user_version = 4; UPDATE runtime_meta SET value = '4' WHERE key = 'schema_version';");
    runtime.prepare("UPDATE runtime_meta SET value = ? WHERE key = 'root_fingerprint'").run(fingerprint);
    runtime.prepare("UPDATE authority SET schema_version = 4, root_fingerprint = ?, owner_pid = ?, lifecycle = 'ready'").run(fingerprint, ownerPid);
    for (const key of ["owner_history_v3_candidate_gate_v1", "planning_v2_migration_v1", "planning_v2_runtime_v1", "planning_v2_publication_v1"]) {
      runtime.prepare("INSERT INTO runtime_meta VALUES (?, ?)").run(key, JSON.stringify({ fixture: key }));
    }
  } finally {
    runtime.close();
  }
  const admission = new DatabaseSync(path.join(directory, "core-runtime-writer-admission-v1.sqlite"));
  try {
    admission.exec("DROP TABLE admission_lease; DROP TABLE admission_meta;");
    admission.exec(admissionSchema.replace("admission_version = 1", "admission_version = 3").replace("user_version = 1", "user_version = 3"));
    admission.prepare("INSERT INTO admission_meta VALUES ('admission_version', '3'), ('root_fingerprint', ?)").run(fingerprint);
  } finally {
    admission.close();
  }
  return dataRoot;
}

function snapshotFiles(dataRoot) {
  return readdirSync(dataRoot.root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
    .map((file) => [path.relative(dataRoot.root, file), readFileSync(file)]);
}

for (const ownerPid of [999999, process.pid]) {
  test(`v4 runtime and v3 admission are a clean byte-preserving no-op with ${ownerPid === process.pid ? "live" : "dead"} owner`, async () => {
    const dataRoot = upgradeFixtureToV4(makeRoot(), current, ownerPid);
    const before = snapshotFiles(dataRoot);
    const inspection = inspectEduPiRuntimeRecovery(dataRoot, current);
    assert.equal(inspection.status, "clean");
    assert.equal(inspection.reason, null);
    assert.equal(inspection.runtimeFingerprint, current);
    assert.equal(inspection.admissionFingerprint, current);
    const result = await repairEduPiRuntimeState(dataRoot, current);
    assert.equal(result.status, "clean");
    assert.equal(result.repaired, false);
    assert.deepEqual(result.backups, []);
    assert.deepEqual(snapshotFiles(dataRoot), before);
  });
}

for (const staleDatabase of ["both", "runtime", "admission"]) {
  test(`v4 blocks owner-managed recovery for stale ${staleDatabase} fingerprints without mutations`, async () => {
    const stale = "sha256:" + "1".repeat(64);
    const dataRoot = upgradeFixtureToV4(makeRoot(), stale);
    const directory = path.join(dataRoot.root, ".edupi", "runtime");
    if (staleDatabase !== "both") {
      const file = staleDatabase === "runtime" ? "core-runtime-writer-admission-v1.sqlite" : "core-runtime-v1.sqlite";
      const database = new DatabaseSync(path.join(directory, file));
      try {
        if (staleDatabase === "runtime") database.prepare("UPDATE admission_meta SET value = ? WHERE key = 'root_fingerprint'").run(current);
        else {
          database.prepare("UPDATE runtime_meta SET value = ? WHERE key = 'root_fingerprint'").run(current);
          database.prepare("UPDATE authority SET root_fingerprint = ?").run(current);
        }
      } finally {
        database.close();
      }
    }
    const before = snapshotFiles(dataRoot);
    const inspection = inspectEduPiRuntimeRecovery(dataRoot, current);
    assert.equal(inspection.status, "blocked");
    assert.match(inspection.reason, /owner-managed/i);
    await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /owner-managed/i);
    assert.deepEqual(snapshotFiles(dataRoot), before);
  });
}

for (const ownerPid of [999999, process.pid]) {
  test(`v4 preserves a ${ownerPid === process.pid ? "live" : "dead"} v3 admission lease with current fingerprints`, async () => {
    const dataRoot = upgradeFixtureToV4(makeRoot());
    const database = new DatabaseSync(path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite"));
    try {
      database.prepare("INSERT INTO admission_lease VALUES (1, 3, ?, 'daemon', ?, 'p-test', 'lease-v3', '2026-11-09T00:00:00.000Z')").run(current, ownerPid);
    } finally {
      database.close();
    }
    const before = snapshotFiles(dataRoot);
    const inspection = inspectEduPiRuntimeRecovery(dataRoot, current);
    assert.equal(inspection.status, "blocked");
    await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /writer admission|owner-managed/i);
    assert.deepEqual(snapshotFiles(dataRoot), before);
  });
}

for (const [name, file, sql] of [
  ["runtime schema drift", "core-runtime-v1.sqlite", "DROP INDEX planning_v2_history_student_scope_idx"],
  ["admission schema drift", "core-runtime-writer-admission-v1.sqlite", "CREATE TRIGGER unexpected_trigger AFTER UPDATE ON admission_meta BEGIN SELECT 1; END;"],
  ["runtime metadata version mismatch", "core-runtime-v1.sqlite", "UPDATE runtime_meta SET value = '3' WHERE key = 'schema_version'"],
  ["admission metadata version mismatch", "core-runtime-writer-admission-v1.sqlite", "UPDATE admission_meta SET value = '1' WHERE key = 'admission_version'"],
  ["authority version mismatch", "core-runtime-v1.sqlite", "UPDATE authority SET schema_version = 3"],
  ["unsupported future runtime version", "core-runtime-v1.sqlite", "PRAGMA user_version = 5"],
]) {
  test(`v4 rejects ${name} without modifying either database`, async () => {
    const dataRoot = upgradeFixtureToV4(makeRoot());
    const database = new DatabaseSync(path.join(dataRoot.root, ".edupi", "runtime", file));
    try { database.exec(sql); } finally { database.close(); }
    const before = snapshotFiles(dataRoot);
    assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
    await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /incompatible/i);
    assert.deepEqual(snapshotFiles(dataRoot), before);
  });
}

for (const legacyDatabase of ["runtime", "admission"]) {
  test(`v4 rejects a mixed pair with legacy ${legacyDatabase} without mutations`, async () => {
    const dataRoot = upgradeFixtureToV4(makeRoot());
    const legacy = makeRoot();
    const file = legacyDatabase === "runtime" ? "core-runtime-v1.sqlite" : "core-runtime-writer-admission-v1.sqlite";
    const target = path.join(dataRoot.root, ".edupi", "runtime", file);
    const { copyFileSync } = await import("node:fs");
    copyFileSync(path.join(legacy.root, ".edupi", "runtime", file), target);
    const before = snapshotFiles(dataRoot);
    const inspection = inspectEduPiRuntimeRecovery(dataRoot, current);
    assert.equal(inspection.status, "unavailable");
    assert.match(inspection.reason, /versions.*incompatible/i);
    await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /versions.*incompatible/i);
    assert.deepEqual(snapshotFiles(dataRoot), before);
  });
}

test("v4 cannot consume or remove an interrupted v1 repair intent", async () => {
  const dataRoot = makeRoot();
  await assert.rejects(
    () => repairEduPiRuntimeState(dataRoot, current, { afterRuntimeCommit() { throw new Error("simulated interruption"); } }),
    /simulated interruption/,
  );
  upgradeFixtureToV4(dataRoot);
  const before = snapshotFiles(dataRoot);
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "clean");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /v1 repair intent/i);
  assert.deepEqual(snapshotFiles(dataRoot), before);
});

test("classifies an idle stale runtime as repairable", () => {
  const dataRoot = makeRoot();
  const result = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(result.status, "stale");
  assert.equal(result.reason, null);
});

test("fails closed when either pinned runtime database is missing", async () => {
  const emptyRoot = makeRoot();
  const emptyRuntime = path.join(emptyRoot.root, ".edupi", "runtime");
  unlinkSync(path.join(emptyRuntime, "core-runtime-v1.sqlite"));
  unlinkSync(path.join(emptyRuntime, "core-runtime-writer-admission-v1.sqlite"));
  const emptyInspection = inspectEduPiRuntimeRecovery(emptyRoot, current);
  assert.equal(emptyInspection.status, "unavailable");
  assert.match(emptyInspection.reason, /incomplete/i);
  await assert.rejects(() => repairEduPiRuntimeState(emptyRoot, current), /incomplete/i);

  const partialRoot = makeRoot();
  unlinkSync(path.join(partialRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite"));
  const partialInspection = inspectEduPiRuntimeRecovery(partialRoot, current);
  assert.equal(partialInspection.status, "unavailable");
  assert.match(partialInspection.reason, /incomplete/i);
  await assert.rejects(() => repairEduPiRuntimeState(partialRoot, current), /incomplete/i);
});

test("repairs only runtime metadata and leaves teacher directories untouched", async () => {
  const dataRoot = makeRoot();
  const result = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(result.repaired, true);
  assert.equal(result.status, "clean");
  assert.equal(result.backups.length, 2);
  assert.equal(existsSync(path.join(dataRoot.root, ".edupi", "memory")), true);
});

test("refuses repair while a live admission lease is present", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO admission_lease VALUES (1, 1, ?, 'daemon', ?, 'p-test', 'lease-test', '2026-09-21T00:00:00.000Z')").run("sha256:" + "1".repeat(64), process.pid);
  db.close();
  const result = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(result.status, "blocked");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /writer admission|active/i);
});

test("removes a valid admission lease left by a dead owner", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO admission_lease VALUES (1, 1, ?, 'daemon', 999999, 'p-test', 'lease-test', '2026-09-21T00:00:00.000Z')").run("sha256:" + "1".repeat(64));
  db.close();

  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "stale");
  const repaired = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(repaired.status, "clean");
  const recovered = new DatabaseSync(file, { readOnly: true });
  assert.equal(recovered.prepare("SELECT COUNT(*) AS count FROM admission_lease").get().count, 0);
  recovered.close();
});

test("cleans a dead admission lease even when both fingerprints are current", async () => {
  const dataRoot = makeRoot();
  await repairEduPiRuntimeState(dataRoot, current);
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO admission_lease VALUES (1, 1, ?, 'daemon', 999999, 'p-test', 'lease-current', '2026-09-21T00:00:00.000Z')").run(current);
  db.close();

  const inspection = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(inspection.status, "stale");
  const repaired = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(repaired.status, "clean");
  assert.equal(repaired.repaired, true);
  const recovered = new DatabaseSync(file, { readOnly: true });
  assert.equal(recovered.prepare("SELECT COUNT(*) AS count FROM admission_lease").get().count, 0);
  recovered.close();
});

test("refuses repair while the runtime owner is active", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE authority SET lifecycle = 'ready', owner_pid = ? WHERE singleton = 1").run(process.pid);
  db.close();
  const result = inspectEduPiRuntimeRecovery(dataRoot, current);
  assert.equal(result.status, "blocked");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /owner|active/i);
});

test("treats an already-current active runtime as a clean no-op", async () => {
  const dataRoot = makeRoot();
  await repairEduPiRuntimeState(dataRoot, current);
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE authority SET lifecycle = 'ready', owner_pid = ? WHERE singleton = 1").run(process.pid);
  db.close();
  const result = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(result.status, "clean");
  assert.equal(result.repaired, false);
});

test("repairs a stale runtime left ready by a dead owner", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE authority SET lifecycle = 'ready', owner_pid = 999999 WHERE singleton = 1").run();
  db.close();
  const result = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(result.status, "clean");
  assert.equal(result.repaired, true);
});

test("creates a consistent SQLite backup that includes committed WAL pages", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const writer = new DatabaseSync(file);
  writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; UPDATE authority SET updated_at = '2026-09-21T00:00:01.000Z';");
  try {
    const result = await repairEduPiRuntimeState(dataRoot, current);
    const runtimeBackup = result.backups.find((backup) => backup.includes("core-runtime-v1.sqlite.before-root-repair"));
    assert.ok(runtimeBackup);
    const backupDb = new DatabaseSync(runtimeBackup, { readOnly: true });
    try {
      assert.equal(backupDb.prepare("SELECT updated_at FROM authority WHERE singleton = 1").get().updated_at, "2026-09-21T00:00:01.000Z");
    } finally {
      backupDb.close();
    }
  } finally {
    writer.close();
  }
});

test("cannot race an admission owner that starts after inspection", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const owner = new DatabaseSync(file);
  owner.exec("BEGIN IMMEDIATE");
  try {
    await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /locked|busy/i);
    assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "stale");
  } finally {
    owner.exec("ROLLBACK");
    owner.close();
  }
});

test("rejects unsupported schema versions before changing a fingerprint", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA user_version = 2");
  db.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /schema/i);
  const unchanged = new DatabaseSync(file, { readOnly: true });
  assert.equal(unchanged.prepare("SELECT value FROM runtime_meta WHERE key = 'root_fingerprint'").get().value, "sha256:" + "1".repeat(64));
  unchanged.close();
});

test("rejects an extra trigger before changing admission metadata", async () => {
  const dataRoot = makeRoot();
  const file = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER unexpected_trigger AFTER UPDATE ON admission_meta BEGIN SELECT 1; END;");
  db.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /schema/i);
});

test("rejects unexpected metadata rows and versions before changing a fingerprint", async () => {
  const dataRoot = makeRoot();
  const admissionFile = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-writer-admission-v1.sqlite");
  const admission = new DatabaseSync(admissionFile);
  admission.prepare("INSERT INTO admission_meta VALUES ('unexpected', 'value')").run();
  admission.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /metadata/i);

  const second = makeRoot();
  const runtimeFile = path.join(second.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const runtime = new DatabaseSync(runtimeFile);
  runtime.prepare("UPDATE authority SET schema_version = 2 WHERE singleton = 1").run();
  runtime.close();
  assert.equal(inspectEduPiRuntimeRecovery(second, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(second, current), /authority/i);
});

test("rejects a missing runtime authority row", async () => {
  const dataRoot = makeRoot();
  const runtimeFile = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-v1.sqlite");
  const runtime = new DatabaseSync(runtimeFile);
  runtime.prepare("DELETE FROM authority WHERE singleton = 1").run();
  runtime.close();
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "unavailable");
  await assert.rejects(() => repairEduPiRuntimeState(dataRoot, current), /authority/i);
});

test("resumes a repair interrupted after the runtime commit", async () => {
  const dataRoot = makeRoot();
  await assert.rejects(
    () => repairEduPiRuntimeState(dataRoot, current, { afterRuntimeCommit() { throw new Error("simulated interruption"); } }),
    /simulated interruption/,
  );
  const intent = path.join(dataRoot.root, ".edupi", "runtime", "core-runtime-root-repair-v1.json");
  assert.equal(existsSync(intent), true);
  const firstIntent = JSON.parse(await (await import("node:fs/promises")).readFile(intent, "utf8"));
  assert.equal(inspectEduPiRuntimeRecovery(dataRoot, current).status, "stale");
  const recovered = await repairEduPiRuntimeState(dataRoot, current);
  assert.equal(recovered.status, "clean");
  assert.deepEqual(recovered.backups.map((file) => path.basename(file)), [firstIntent.runtimeBackup, firstIntent.admissionBackup]);
  assert.equal(existsSync(intent), false);
});
