import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const [security, bounded, server, versions, imports, rosterModel, rosterFile, cloudClient] = await Promise.all([
  jiti.import("../../../../lib/request-security.ts"), jiti.import("../../../../lib/bounded-form-data.ts"),
  jiti.import("../../../../lib/edupi-student-roster-server.ts"),
  jiti.import("../../../../lib/edupi-student-profile-versions.ts"),
  jiti.import("../../../../lib/edupi-student-roster-import.ts"),
  jiti.import("../../../../lib/edupi-student-roster-model.ts"),
  jiti.import("../../../../lib/edupi-student-roster-file.ts"),
  jiti.import("../../../../lib/edupi-cloud-client.ts"),
]);
const scope = { issuer: "https://example.invalid", accountId: "account-a", workspaceId: "workspace-a", generation: 3 };
const params = { params: Promise.resolve({ name: "合成学生" }) };
function request(path, method = "GET", body) {
  return new Request(`http://localhost/api/edupi/students/${path}`, {
    method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function setup(extra = {}) {
  const calls = [];
  const local = () => { calls.push("local"); throw new Error("local Core must not be reached"); };
  const client = { state: async () => ({ mode: "cloud" }), captureScope: async () => scope };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/request-security": security,
    "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-education-server": { readEducationContract: local },
    "@/lib/edupi-student-roster-server": { ...server, importStudentRoster: local, updateStudentProfile: local },
    "@/lib/edupi-student-profile-versions": { ...versions, readStudentProfileVersions: local, restoreStudentProfileVersion: local },
    "@/lib/edupi-student-roster-import": imports,
    "@/lib/edupi-student-roster-model": rosterModel,
    "@/lib/edupi-student-roster-file": rosterFile,
    "@/lib/edupi-cloud-client": { createEduPiCloudClient: () => client, EduPiCloudError: cloudClient.EduPiCloudError },
    "@/lib/edupi-cloud-request-scope": { captureEducationWriteScope: async (_request, selected) => {
      assert.equal(selected, client); return { mode: "cloud", scope };
    } },
    "@/lib/edupi-cloud-students": {
      readCloudStudentEducationData: async (selected, captured) => {
        assert.equal(selected, client); assert.equal(captured, scope); calls.push("read-data");
        return { students: [{ student_id: "student-a", name: "合成学生", class_name: "一班", traits: ["认真"], parent_notes: [] }] };
      },
      importCloudStudentRoster: async (input, selected, captured) => {
        assert.equal(selected, client); assert.equal(captured, scope); calls.push(["import", input]);
        return { ok: true, operation: "students", imported: input.students.length, external_send: false };
      },
      updateCloudStudentProfile: async (input, selected, captured) => {
        assert.equal(selected, client); assert.equal(captured, scope); calls.push(["update", input]);
        return { studentId: "student-a", profileRevision: 1 };
      },
    },
    ...extra,
  };
  function load(path) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      exports, Request, Response, URL, File, console,
      require(name) { assert.ok(modules[name], `missing module ${name}`); return modules[name]; },
    });
    return exports;
  }
  return { calls, load, modules, client };
}

test("student cloud update stays bound to the captured workspace and never falls through to Core", async () => {
  const { calls, load } = setup();
  const { PUT } = load("./[name]/route.ts");
  const response = await PUT(request("合成学生", "PUT", {
    studentId: "student-a", className: "一班", traits: ["认真"], parentNotes: [],
    expectedUpdatedAt: "2026-11-22T00:00:00Z", expectedRevision: 0,
  }), params);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ["update", "read-data"]);
});

test("student cloud writes reject a stale page scope before any local or cloud mutation", async () => {
  const { calls, load } = setup({
    "@/lib/edupi-cloud-request-scope": { captureEducationWriteScope: async () => {
      throw new cloudClient.EduPiCloudError("scope_changed", "工作区已改变", 409);
    } },
  });
  const { PUT } = load("./[name]/route.ts");
  const response = await PUT(request("合成学生", "PUT", {
    studentId: "student-a", traits: [], parentNotes: [],
    expectedUpdatedAt: "2026-11-22T00:00:00Z", expectedRevision: 0,
  }), params);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "scope_changed");
  assert.deepEqual(calls, []);
});

test("queued student edits return pending status without a false saved result", async () => {
  const state = setup();
  state.modules["@/lib/edupi-cloud-students"].updateCloudStudentProfile = async () => {
    const error = new cloudClient.EduPiCloudError("write_queued", "等待同步", 202);
    error.outboxId = "pending-student-a"; throw error;
  };
  const { PUT } = state.load("./[name]/route.ts");
  const response = await PUT(request("合成学生", "PUT", {
    studentId: "student-a", traits: [], parentNotes: [],
    expectedUpdatedAt: "2026-11-22T00:00:00Z", expectedRevision: 0,
  }), params);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.queued, true);
  assert.equal(body.outboxId, "pending-student-a");
  assert.equal(body.result, null);
  assert.equal(body.data, null);
  assert.deepEqual(state.calls, []);
});

test("manual cloud import uses the original roster parser and verifies a scoped education reread", async () => {
  const { calls, load } = setup();
  const { POST } = load("./import/route.ts");
  const response = await POST(request("import", "POST", {
    sourceName: "名单.csv", csv: "姓名,班级,特征\n合成学生,一班,认真",
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verified, true);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ["import", "read-data"]);
  assert.match(calls[0][1].requestId, /^student-roster-manual-/);
});

test("cloud history reads avoid local Core and validate the requested name and identity", async () => {
  const state = setup();
  state.modules["@/lib/edupi-cloud-students"].readCloudStudentProfileVersions = async (id, selected, captured) => {
    assert.equal(id, "student-a"); assert.equal(selected, state.client); assert.equal(captured, scope);
    return { studentId: id, studentName: "合成学生", profileRevision: 0, profileHistoryCount: 0, versions: [], externalSend: false };
  };
  const { GET } = state.load("./[name]/versions/route.ts");
  const response = await GET(request("合成学生/versions?studentId=student-a"), params);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).history.studentId, "student-a");
  assert.deepEqual(state.calls, []);
});

test("cloud restore verifies the new version and reconciles a repeat without writing twice", async () => {
  const state = setup();
  const beforeValues = { className: "一班", traits: ["认真"], parentNotes: [] };
  const afterValues = { className: "二班", traits: ["主动"], parentNotes: [] };
  let history = {
    studentId: "student-a", studentName: "合成学生", profileRevision: 1, profileHistoryCount: 1, externalSend: false,
    versions: [{ versionId: "visible-core-version", studentId: "student-a", revision: 1,
      beforeValues, afterValues, sourceKind: "teacher_edit", requestId: "first-edit" }],
  };
  let current = afterValues;
  let writes = 0;
  state.modules["@/lib/edupi-cloud-students"] = {
    readCloudStudentProfileVersions: async () => history,
    readCloudStudentEducationData: async () => ({
      students: [{ student_id: "student-a", name: "合成学生", class_name: current.className,
        traits: current.traits, parent_notes: current.parentNotes,
        profile_revision: history.profileRevision, profile_history_count: history.profileHistoryCount }],
    }),
    restoreCloudStudentProfileVersion: async (input, selected, captured) => {
      assert.equal(selected, state.client); assert.equal(captured, scope); writes++;
      const requestId = versions.studentProfileRestoreRequestId(input);
      current = beforeValues;
      // The source can leave a bounded history window as the restore appends.
      history = { ...history, profileRevision: 2, profileHistoryCount: 1,
        versions: [{ versionId: "restored-core-version", revision: 2, sourceKind: "restore",
          requestId, beforeValues: afterValues, afterValues: beforeValues }] };
      return { requestId, profileRevision: 2, profileHistoryCount: 1, versionId: "restored-core-version" };
    },
  };
  const { POST } = state.load("./[name]/versions/route.ts");
  const body = { studentId: "student-a", versionId: "visible-core-version", versionSide: "before", expectedRevision: 1 };
  const response = await POST(request("合成学生/versions", "POST", body), params);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reconciled, false);
  const repeated = await POST(request("合成学生/versions", "POST", body), params);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).reconciled, true);
  assert.equal(writes, 1);
  assert.equal(state.calls.includes("local"), false);
});
