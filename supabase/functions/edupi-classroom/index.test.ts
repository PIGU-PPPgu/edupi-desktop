import { handleClassroomRequest } from "./index.ts";
import { computeGrades } from "./core/grade.mjs";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const workspace = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
const request = (body: unknown) => new Request("https://fixture.invalid/edupi-classroom", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function writeBody() {
  const input = { title: "合成考试", class_name: "隔离班", date: "2026-11-23", subjects: [{ name: "数学", max_score: 100 }],
    rows: [{ row_id: "r1", student_id: "s1", name: "合成学生", class_name: "隔离班", scores: { 数学: 70 } }] };
  const roster = [{ student_id: "s1", name: "合成学生", class_name: "隔离班", traits: [], revision: 0, profile_revision: 0 }];
  const computed = { ...computeGrades(input, roster), source_input: input, roster, references: [],
    core_commit: "fc89b3bc899a55b0fdad61b8f37e238d950f37c6" };
  const source = { action: "save", domain: "grades", id: "grade-a", expected_revision: 0, request_id: "save", input };
  return { ...source, source_request: source, computed };
}
Deno.test("Edge refuses placeholder preview and uncomputed writes without calling a database", async () => {
  let calls = 0;
  const deps = { context: async () => { calls++; throw new Error("unexpected call"); } };
  for (const body of [
    { action: "preview", domain: "grades", request_id: "preview" },
    { action: "save", domain: "duty", request_id: "save", id: "duty-a", expected_revision: 0 },
  ]) {
    const response = await handleClassroomRequest(request(body), deps);
    assert(response.status === 400);
    assert((await response.json()).code.includes("compute_required"));
  }
  assert(calls === 0);
});
Deno.test("Edge forwards exact actor/workspace/payload to the durable writer", async () => {
  const body = writeBody();
  const calls: string[] = [];
  const response = await handleClassroomRequest(request(body), {
    context: async () => ({ workspaceId: workspace, user: { id: actor }, adminDb: {
      rpc(name, args) {
        calls.push(name);
        assert(["admit_classroom_computation", "mutate_classroom_object"].includes(name));
        assert(args.target_workspace === workspace && args.actor_id === actor);
        assert(JSON.stringify(args.classroom_request) === JSON.stringify(body));
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    } }),
  });
  assert(response.status === 200);
  assert(calls.join(",") === "admit_classroom_computation,mutate_classroom_object");
});
Deno.test("Edge maps immutable request conflicts to a visible 409", async () => {
  const response = await handleClassroomRequest(request(writeBody()), {
    context: async () => ({ workspaceId: workspace, user: { id: actor }, adminDb: {
      rpc() { return Promise.resolve({ data: null, error: { message: "idempotency_conflict" } }); },
    } }),
  });
  assert(response.status === 409);
  assert((await response.json()).code === "idempotency_conflict");
});
Deno.test("forged nonempty result never receives server admission", async () => {
  const body = writeBody();
  assert(body.computed.result);
  body.computed.result.subjects[0].mean = 999;
  let calls = 0;
  const response = await handleClassroomRequest(request(body), {
    context: async () => ({ workspaceId: workspace, user: { id: actor }, adminDb: {
      rpc() { calls++; return Promise.resolve({ data: {}, error: null }); },
    } }),
  });
  assert(response.status === 400);
  assert(calls === 0);
});
Deno.test("admission outage remains retryable rather than becoming a false conflict", async () => {
  const response = await handleClassroomRequest(request(writeBody()), {
    context: async () => ({ workspaceId: workspace, user: { id: actor }, adminDb: {
      rpc() { return Promise.resolve({ data: null, error: { message: "connection unavailable" } }); },
    } }),
  });
  assert(response.status === 503);
  assert((await response.json()).code === "classroom_unavailable");
});
Deno.test("a valid result cannot be attached to a different original save input", async () => {
  const body = writeBody();
  body.source_request.input = structuredClone(body.source_request.input);
  body.source_request.input.title = "另一个请求";
  let calls = 0;
  const response = await handleClassroomRequest(request(body), {
    context: async () => ({ workspaceId: workspace, user: { id: actor }, adminDb: {
      rpc() { calls++; return Promise.resolve({ data: {}, error: null }); },
    } }),
  });
  assert(response.status === 400);
  assert(calls === 0);
});
