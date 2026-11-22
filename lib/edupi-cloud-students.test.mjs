import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const {
  normalizeCloudStudentProfileHistory,
  verifyCloudStudentWrite,
  restoreCloudStudentProfileVersion,
  importCloudStudentRoster,
  updateCloudStudentProfile,
} = {
  ...await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./edupi-cloud-students.ts"),
  ...await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./edupi-cloud-students-verification.ts"),
};
const workspace = "10000000-0000-4000-8000-000000000001";
const scope = { issuer: "https://example.invalid", accountId: "account-a", workspaceId: workspace, generation: 1 };
const before = { class_name: "一班", traits: ["认真"], parent_notes: [] };
const after = { class_name: "二班", traits: ["主动提问"], parent_notes: ["已沟通"] };
const version = {
  version_id: "cloud-student-profile-a", student_id: "student-a", revision: 1,
  before, after, changed_fields: ["class_name", "traits", "parent_notes"],
  changed_at: "2026-11-23T01:00:00.000Z", source_kind: "teacher_edit", request_id: "edit-a",
};
const student = {
  student_id: "student-a", name: "合成学生", ...after, profile_revision: 1,
  profile_history_count: 1, revision: 1, updated_at: version.changed_at, deleted_at: null,
  error_patterns: [{ description: "移项" }], trajectory: [{ event: "进步" }],
};
function historyResponse() {
  return {
    ok: true, operation: "students", action: "history", request_id: "read-a",
    workspace_id: workspace, student: structuredClone(student), external_send: false,
    studentProfileVersions: {
      student_id: "student-a", student_name: "合成学生", profile_revision: 1,
      profile_history_count: 1, versions: [structuredClone(version)], external_send: false,
    },
  };
}
function receipt(action = "update") {
  return {
    ok: true, operation: "students", action, request_id: "edit-a", updated: 1,
    student_id: "student-a", student_name: "合成学生", version_id: version.version_id,
    profile_revision: 1, profile_history_count: 1, updated_at: version.changed_at,
    total: 1, replayed: false, external_send: false,
  };
}
const update = {
  action: "update", request_id: "edit-a", expected_revision: 0,
  expected_updated_at: "2026-11-22T01:00:00.000Z",
  student: { student_id: "student-a", name: "合成学生", ...after },
};

test("cloud history converts storage IDs into the existing content-bound Core IDs", () => {
  const result = normalizeCloudStudentProfileHistory(historyResponse(), workspace, "student-a");
  const { version_id: _id, changed_fields: _fields, ...identity } = version;
  const expected = `student-profile-${createHash("sha256").update(JSON.stringify(identity)).digest("base64url")}`;
  assert.equal(result.versions[0].versionId, expected);
  assert.deepEqual(result.versions[0].afterValues, { className: "二班", traits: ["主动提问"], parentNotes: ["已沟通"] });
});

test("cloud history rejects another workspace, another student, broken chains and forged fields", () => {
  for (const mutate of [
    value => { value.workspace_id = "other"; },
    value => { value.student.student_id = "other"; },
    value => { value.studentProfileVersions.versions[0].student_id = "other"; },
    value => { value.studentProfileVersions.versions[0].changed_fields = ["traits"]; },
    value => { value.studentProfileVersions.profile_history_count = 2; },
    value => { value.student.deleted_at = "2026-11-23T01:00:00Z"; },
    value => { value.student.traits = ["different"]; },
  ]) {
    const value = historyResponse(); mutate(value);
    assert.throws(() => normalizeCloudStudentProfileHistory(value, workspace, "student-a"));
  }
});

test("student write verification reads the exact student and history, preserving identity and revision", async () => {
  await verifyCloudStudentWrite(update, receipt(), workspace, async (operation, body) => {
    assert.equal(operation, "students");
    assert.equal(body.action, "history"); assert.equal(body.student_id, "student-a");
    return historyResponse();
  });
  for (const mutate of [
    value => { value.student.name = "另一个学生"; },
    value => { value.student.profile_revision = 2; },
    value => { value.student.parent_notes = []; },
    value => { value.studentProfileVersions.versions[0].request_id = "other"; },
    value => { value.workspace_id = "other"; },
  ]) {
    const response = historyResponse(); mutate(response);
    await assert.rejects(verifyCloudStudentWrite(update, receipt(), workspace, async () => response));
  }
  await assert.rejects(verifyCloudStudentWrite(update, { ...receipt(), request_id: "other" }, workspace, async () => historyResponse()));
});

test("import verification requires each receipt identity and merged profile to survive readback", async () => {
  const body = {
    action: "import", request_id: "import-a", source_name: "合成名单.csv",
    students: [{ name: "合成学生", class_name: "二班", traits: ["主动提问"], parent_notes: [] }],
  };
  const result = {
    ok: true, operation: "students", action: "import", request_id: "import-a",
    created: 0, updated: 1, imported: 1, total: 1, replayed: false, external_send: false,
    students: [{ ...student }],
  };
  const response = { ok: true, operation: "students", action: "list", workspace_id: workspace, students: [{ ...student }], external_send: false };
  await verifyCloudStudentWrite(body, result, workspace, async () => response);
  await assert.rejects(verifyCloudStudentWrite(body, result, workspace, async () => ({
    ...response, students: [{ ...student, student_id: "same-name-other-class" }],
  })));
  await assert.rejects(verifyCloudStudentWrite(body, result, workspace, async () => ({
    ...response, students: [{ ...student, profile_revision: 2 }],
  })));
  await assert.rejects(verifyCloudStudentWrite(body, result, workspace, async () => ({
    ...response, students: [{ ...student, updated_at: "2026-11-23T02:00:00.000Z" }],
  })), /已被其他入口更新/);
});

test("cloud roster requests keep a stable identity when callers omit requestId", async () => {
  const writes = [];
  const client = {
    operationWithOutbox: async (_operation, body) => { writes.push(body); throw new Error("offline"); },
  };
  const input = { students: [{ name: "合成学生", className: "一班", traits: [], parentNotes: [] }], sourceName: "名单.csv" };
  await assert.rejects(importCloudStudentRoster(input, client, scope), /offline/);
  await assert.rejects(importCloudStudentRoster(structuredClone(input), client, scope), /offline/);
  assert.equal(writes[0].request_id, writes[1].request_id);
  assert.equal(writes[0].operation, undefined);
  assert.equal(writes[0].students[0].class_name, "一班");
});

test("a queued cloud write stays pending and is never reported as a verified roster", async () => {
  let reads = 0;
  const client = {
    operationWithOutbox: async () => ({ queued: true, entry: { id: "outbox-a" } }),
    operation: async () => { reads++; throw new Error("uncommitted write must not be read as success"); },
  };
  await assert.rejects(importCloudStudentRoster({
    students: [{ name: "合成学生", traits: [], parentNotes: [] }], sourceName: "名单.csv",
  }, client, scope), error => error.code === "write_queued" && error.status === 202 && error.outboxId === "outbox-a");
  assert.equal(reads, 0);
});

test("restore maps the visible Core version ID back to its cloud storage ID", async () => {
  const history = normalizeCloudStudentProfileHistory(historyResponse(), workspace, "student-a");
  let write;
  const client = {
    operation: async () => historyResponse(),
    operationWithOutbox: async (operation, body, selected) => {
      assert.equal(operation, "students"); assert.equal(selected, scope); write = body;
      throw new Error("captured");
    },
  };
  await assert.rejects(restoreCloudStudentProfileVersion({
    studentId: "student-a", studentName: "合成学生", versionId: history.versions[0].versionId,
    versionSide: "before", expectedRevision: 1,
  }, client, scope), /captured/);
  assert.equal(write.version_id, version.version_id);
  assert.equal(write.student_name, "合成学生");
  assert.equal(write.expected_revision, 1);
  assert.equal(write.expected_updated_at, undefined, "restore retries keep the Core revision-bound intent stable");
});

test("cloud update unwraps the outbox result, verifies actual state and returns a Core-compatible version receipt", async () => {
  let request;
  const client = {
    operationWithOutbox: async (operation, body) => {
      assert.equal(operation, "students"); request = body;
      return { queued: false, result: { ...receipt(), request_id: body.request_id } };
    },
    operation: async (operation, body) => {
      assert.equal(operation, "students"); assert.equal(body.action, "history");
      const response = historyResponse();
      response.studentProfileVersions.versions[0].request_id = request.request_id;
      return response;
    },
  };
  const result = await updateCloudStudentProfile({
    name: "合成学生", studentId: "student-a", className: "二班", traits: ["主动提问"],
    parentNotes: ["已沟通"], expectedRevision: 0, expectedUpdatedAt: update.expected_updated_at,
  }, client, scope);
  assert.equal(result.profileRevision, 1);
  assert.match(result.versionId, /^student-profile-[A-Za-z0-9_-]{43}$/);
  assert.notEqual(result.versionId, version.version_id);
  assert.equal(result.requestId, request.request_id);
});

test("cloud restore retries reuse the same body after the current profile timestamp changes", async () => {
  const visible = normalizeCloudStudentProfileHistory(historyResponse(), workspace, "student-a").versions[0].versionId;
  const writes = [];
  let restoredResponse;
  const client = {
    operation: async () => restoredResponse || historyResponse(),
    operationWithOutbox: async (_operation, body) => {
      writes.push(structuredClone(body));
      const restoredVersion = {
        ...version, version_id: "cloud-student-profile-restore", revision: 2,
        before: after, after: before, source_kind: "restore", request_id: body.request_id,
        changed_at: "2026-11-23T02:00:00.000Z",
      };
      restoredResponse = historyResponse();
      restoredResponse.student = {
        ...student, ...before, profile_revision: 2, profile_history_count: 2,
        revision: 2, updated_at: restoredVersion.changed_at,
      };
      restoredResponse.studentProfileVersions = {
        ...restoredResponse.studentProfileVersions, profile_revision: 2, profile_history_count: 2,
        versions: [version, restoredVersion],
      };
      restoredResponse.selected_version = version;
      return { queued: false, result: {
        ...receipt("restore"), request_id: body.request_id, version_id: restoredVersion.version_id,
        profile_revision: 2, profile_history_count: 2, updated_at: restoredVersion.changed_at,
      } };
    },
  };
  const input = {
    studentId: "student-a", studentName: "合成学生", versionId: visible,
    versionSide: "before", expectedRevision: 1,
  };
  const result = await restoreCloudStudentProfileVersion(input, client, scope);
  await restoreCloudStudentProfileVersion(input, client, scope);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(result.profileRevision, 2);
  assert.match(result.versionId, /^student-profile-[A-Za-z0-9_-]{43}$/);
});
