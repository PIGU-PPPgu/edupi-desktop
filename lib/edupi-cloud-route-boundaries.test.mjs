import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class CloudError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
function load(file, modules) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, Request, URL, URLSearchParams, require(name) { assert.ok(modules[name], `Missing fixture module ${name}`); return modules[name]; },
  });
  return exports;
}
const jsonRequest = (url, body) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("cloud task reviews are explicitly rejected before the local Core review adapter", async () => {
  let localCalls = 0;
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/edupi-education-server": { reviewEducationTask: () => { localCalls++; throw new Error("local writer reached"); } },
    "@/lib/edupi-task-review": { TASK_REVIEW_DECISIONS: ["accept", "modify", "reject", "hold", "rollback"], TaskReviewError: class extends Error {} },
    "@/lib/request-security": { isApiRequestAllowed: () => true, hasJsonContentType: () => true },
    "@/lib/edupi-cloud-client": { EduPiCloudError: CloudError },
    "@/lib/edupi-cloud-request-scope": { captureEducationWriteScope: async () => ({ mode: "cloud" }) },
  };
  const route = load("../app/api/edupi/tasks/[taskId]/review/route.ts", modules);
  const response = await route.POST(jsonRequest("http://localhost/api/edupi/tasks/shared-id/review", {
    decision: "accept", expectedRevision: 0,
  }), { params: Promise.resolve({ taskId: "shared-id" }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "unsupported_cloud_operation");
  assert.equal(localCalls, 0);
});

test("cloud Today candidate reviews never call the local candidate writer", async () => {
  let localCalls = 0;
  const route = load("../app/api/edupi/education/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/edupi-core-snapshot": { EduPiSnapshotError: class extends Error {} },
    "@/lib/edupi-work-candidate-review": {
      WorkCandidateReviewError: class extends Error {},
      WORK_CANDIDATE_REVIEW_DECISIONS: ["accept", "modify", "reject", "hold", "snooze", "suppress"],
    },
    "@/lib/edupi-education-server": { reviewWorkCandidate: () => { localCalls++; throw new Error("local writer reached"); } },
    "@/lib/edupi-cloud-client": { EduPiCloudError: CloudError },
    "@/lib/edupi-cloud-request-scope": { captureEducationWriteScope: async () => ({ mode: "cloud" }) },
  });
  const response = await route.POST(jsonRequest("http://localhost/api/edupi/education", {
    commandType: "review_work_candidate", candidateId: "shared-id", expectedSnapshotId: "old-snapshot",
    expectedRevision: 0, decision: "accept",
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "unsupported_cloud_operation");
  assert.equal(localCalls, 0);
});

test("cloud student-event forwarding preserves the legacy student-name filter", async () => {
  const calls = [];
  const scope = { workspaceId: "workspace-a", accountId: "account-a", generation: 4 };
  const route = load("../app/api/edupi/student-events/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/edupi-student-events": { studentEventRequest: () => { throw new Error("local event reader reached"); } },
    "@/lib/bounded-form-data": {},
    "@/lib/request-security": { isApiRequestAllowed: () => true },
    "@/lib/edupi-cloud-client": {
      createEduPiCloudClient: () => ({
        state: async () => ({ mode: "cloud" }),
        captureScope: async () => scope,
        dashboard: async selected => {
          assert.equal(selected, scope);
          return { payload: { students: [{ student_id: "exact-student-id", name: "合成学生" }] } };
        },
        edge: async (name, input, selected) => { calls.push({ name, input, scope: selected }); return { ok: true, records: [] }; },
      }),
    },
    "@/lib/edupi-cloud-request-scope": {},
  });
  const request = new Request("http://localhost/api/edupi/student-events?student=%E5%90%88%E6%88%90%E5%AD%A6%E7%94%9F&kind=learning&offset=20");
  const response = await route.GET(request);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const params = new URLSearchParams(calls[0].input.query.slice(1));
  assert.equal(params.get("student"), "合成学生");
  assert.equal(params.get("student_id"), "exact-student-id");
  assert.equal(calls[0].scope, scope);
  assert.equal(params.get("kind"), "learning");
  assert.equal(params.get("offset"), "20");
});

test("missing or ambiguous legacy names never reach an unfiltered event query", async () => {
  for (const students of [[], [{ student_id: "another-id", name: "另一学生" }],
    [{ student_id: "same-1", name: "合成学生" }, { student_id: "same-2", name: "合成学生" }]]) {
    let edgeCalls = 0;
    const route = load("../app/api/edupi/student-events/route.ts", {
      "next/server": { NextResponse: Response },
      "@/lib/edupi-student-events": {},
      "@/lib/bounded-form-data": {},
      "@/lib/request-security": { isApiRequestAllowed: () => true },
      "@/lib/edupi-cloud-client": { createEduPiCloudClient: () => ({
        state: async () => ({ mode: "cloud" }), captureScope: async () => ({}),
        dashboard: async () => ({ payload: { students } }),
        edge: async () => { edgeCalls++; throw new Error("unfiltered query reached"); },
      }) },
      "@/lib/edupi-cloud-request-scope": {},
    });
    const response = await route.GET(new Request("http://localhost/api/edupi/student-events?student=%E5%90%88%E6%88%90%E5%AD%A6%E7%94%9F"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).records.length, 0);
    assert.equal(edgeCalls, 0);
  }
});

test("invalid student selectors are rejected before any dashboard or event request", async () => {
  let cloudReads = 0;
  const route = load("../app/api/edupi/student-events/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/edupi-student-events": {},
    "@/lib/bounded-form-data": {},
    "@/lib/request-security": { isApiRequestAllowed: () => true },
    "@/lib/edupi-cloud-client": { createEduPiCloudClient: () => ({
      state: async () => ({ mode: "cloud" }), captureScope: async () => ({}),
      dashboard: async () => { cloudReads++; throw new Error("invalid selector reached cloud"); },
      edge: async () => { cloudReads++; throw new Error("invalid selector reached cloud"); },
    }) },
    "@/lib/edupi-cloud-request-scope": {},
  });
  for (const query of ["student=%00", "student_id=%00", "student=", "student_id=", `student=${"a".repeat(241)}`]) {
    const response = await route.GET(new Request(`http://localhost/api/edupi/student-events?${query}`));
    assert.equal(response.status, 400);
  }
  assert.equal(cloudReads, 0);
});
