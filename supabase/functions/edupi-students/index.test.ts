import { handleStudentsRequest } from "./index.ts";

const workspace = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const profile = {
  student_id: "student-a", name: "合成学生", class_name: "一班", traits: ["认真"], parent_notes: [],
  profile_revision: 0, profile_history_count: 0, revision: 0,
  updated_at: "2026-11-23T00:00:00Z", deleted_at: null,
};
const roster = {
  action: "import", request_id: "roster-a", source_name: "合成名单.csv",
  students: [{ name: "合成学生", class_name: "一班", traits: ["认真"], parent_notes: [] }],
};
const imported = {
  ok: true, operation: "students", action: "import", request_id: "roster-a",
  created: 1, updated: 0, imported: 1, total: 1, replayed: false,
  students: [profile], external_send: false,
};
function request(body: unknown) {
  return new Request("https://example.invalid/edupi-students", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function dependencies(overrides: {
  read?: Record<string, unknown>; result?: Record<string, unknown>; error?: string;
} = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown>; admin: boolean }> = [];
  return {
    calls,
    context: async () => ({
      workspaceId: workspace, user: { id: actor },
      db: {
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args, admin: false });
          return { data: overrides.read || {
            ok: true, operation: "students", action: "list", request_id: "roster-a",
            workspace_id: workspace, students: [profile], external_send: false,
          }, error: null };
        },
      },
      adminDb: {
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args, admin: true });
          return { data: overrides.result || imported, error: overrides.error ? { message: overrides.error } : null };
        },
      },
    }),
  };
}

Deno.test("students Edge requires a durable request ID and rejects extra or actor fields before writing", async () => {
  for (const body of [
    { ...roster, request_id: undefined }, { ...roster, request_id: " " },
    { ...roster, actor_id: actor }, { ...roster, workspace_id: workspace },
    { ...roster, external_send: true }, { ...roster, students: [{ ...roster.students[0], student_id: "untrusted" }] },
  ]) {
    const deps = dependencies();
    const response = await handleStudentsRequest(request(body), deps);
    assert(response.status === 400);
    assert(deps.calls.length === 0);
  }
});

Deno.test("students Edge binds writer to verified account/workspace and independently rereads after import", async () => {
  const deps = dependencies();
  const response = await handleStudentsRequest(request(roster), deps);
  const body = await response.json();
  assert(response.status === 200);
  assert(body.contract.contract_id === "edupi-cloud-sync-v1");
  assert(body.operation === "students" && body.request_id === "roster-a" && body.external_send === false);
  assert(deps.calls.length === 2 && deps.calls[0].name === "mutate_students" && deps.calls[1].name === "read_students");
  assert(deps.calls[0].args.target_workspace === workspace && deps.calls[0].args.actor_id === actor);
  assert(deps.calls[0].admin && !deps.calls[1].admin);
});

Deno.test("students Edge refuses successful receipts whose actual profiles differ", async () => {
  for (const student of [
    { ...profile, student_id: "namesake" }, { ...profile, class_name: "二班" },
    { ...profile, traits: [] }, { ...profile, profile_revision: 1 },
  ]) {
    const deps = dependencies({ read: {
      ok: true, operation: "students", action: "list", request_id: "roster-a",
      workspace_id: workspace, students: [student], external_send: false,
    } });
    const response = await handleStudentsRequest(request(roster), deps);
    assert(response.status === (student.profile_revision > 0 ? 409 : 502));
  }
});

Deno.test("students Edge maps stale, deleted, forbidden and idempotency failures without leaking database errors", async () => {
  for (const [error, status] of [
    ["stale_student", 409], ["idempotency_conflict", 409], ["student_deleted", 410],
    ["student_not_found", 404], ["workspace_forbidden", 403], ["invalid_request", 400],
    ["private database detail", 503],
  ] as const) {
    const response = await handleStudentsRequest(request(roster), dependencies({ error }));
    assert(response.status === status);
    const body = await response.json();
    assert(body.error !== "private database detail");
  }
});

Deno.test("students Edge reads use member client and enforce student identity", async () => {
  const deps = dependencies({ read: {
    ok: true, operation: "students", action: "read", request_id: "read-a",
    workspace_id: workspace, student: profile, external_send: false,
  } });
  const response = await handleStudentsRequest(request({
    action: "read", request_id: "read-a", student_id: "student-a",
  }), deps);
  assert(response.status === 200 && deps.calls.length === 1 && !deps.calls[0].admin);
});
