import { strict as assert } from "node:assert";

const workspaceId = "5c8c6814-6ea2-488c-85b6-bf3d4914ed6d";
const otherWorkspaceId = "851b9c33-bfb2-4d3a-88c5-6a71e2d313d5";
const accountId = "ef4a17e0-f173-48a4-8cb1-a4cc4a27d004";
const studentId = "student-current";
const otherStudentId = "student-other-workspace";
const explicitStudentId = "student-explicit";
const studentName = "王小明";

type Profile = {
  workspace_id: string;
  student_id: string;
  name: string;
  deleted_at: string | null;
};

const currentProfile: Profile = {
  workspace_id: workspaceId,
  student_id: studentId,
  name: studentName,
  deleted_at: null,
};
const otherProfile: Profile = {
  ...currentProfile,
  workspace_id: otherWorkspaceId,
  student_id: otherStudentId,
};
const events = [
  {
    workspace_id: workspaceId,
    event_id: "event-current",
    kind: "learning",
    student_ids: [studentId],
    student_labels: [studentName],
    summary: "当前工作区的测试记录",
  },
  {
    workspace_id: workspaceId,
    event_id: "event-explicit",
    kind: "learning",
    student_ids: [explicitStudentId],
    student_labels: ["李华"],
    summary: "按显式 ID 查询的测试记录",
  },
  {
    workspace_id: otherWorkspaceId,
    event_id: "event-other-workspace",
    kind: "learning",
    student_ids: [otherStudentId],
    student_labels: [studentName],
    summary: "其他工作区的测试记录",
  },
];

Deno.test("student event filters resolve names within the requested workspace", async (test) => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const environment = {
    SUPABASE_URL: "https://edupi-student-filter-test.invalid",
    SUPABASE_ANON_KEY: "test-anon-key",
  };
  const savedEnvironment = new Map(
    Object.keys(environment).map((name) => [name, Deno.env.get(name)]),
  );
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  let profiles: Profile[] = [];
  const profileQueries: URL[] = [];
  const eventCalls: Record<string, unknown>[] = [];

  const reset = (rows: Profile[]) => {
    profiles = rows;
    profileQueries.length = 0;
    eventCalls.length = 0;
  };
  const getEvents = async (params: Record<string, string> = {}) => {
    assert.ok(handler, "Edge Function did not install its handler");
    const url = new URL("https://edupi.invalid/student-events");
    url.search = new URLSearchParams(params).toString();
    const response = await handler(new Request(url, {
      headers: {
        Authorization: "Bearer test-user-token",
        "x-edupi-workspace-id": workspaceId,
      },
    }));
    return { response, body: await response.json() };
  };
  const assertEmpty = (
    result: Awaited<ReturnType<typeof getEvents>>,
  ) => {
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, {
      ok: true,
      records: [],
      total: 0,
      record_ids: [],
      external_send: false,
    });
    assert.equal(eventCalls.length, 0, "unresolved name reached the event RPC");
  };

  try {
    for (const [name, value] of Object.entries(environment)) Deno.env.set(name, value);
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      assert.equal(url.origin, environment.SUPABASE_URL, "unexpected upstream");
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: accountId, aud: "authenticated" });
      }
      if (url.pathname === "/rest/v1/workspace_members") {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${workspaceId}`);
        assert.equal(url.searchParams.get("account_id"), `eq.${accountId}`);
        assert.equal(url.searchParams.get("revoked_at"), "is.null");
        return Response.json([{ role: "teacher" }]);
      }
      if (url.pathname === "/rest/v1/student_profiles") {
        profileQueries.push(url);
        const params = url.searchParams;
        // Honor only filters actually sent, so a missing workspace condition
        // exposes the other workspace's fixture instead of hiding the regression.
        const matches = profiles.filter((profile) =>
          (!params.has("workspace_id") ||
            params.get("workspace_id") === `eq.${profile.workspace_id}`) &&
          (!params.has("name") || params.get("name") === `eq.${profile.name}`) &&
          (params.get("deleted_at") !== "is.null" || profile.deleted_at === null)
        ).slice(0, Number(params.get("limit") || profiles.length));
        return Response.json(matches.map((profile) => ({ student_id: profile.student_id })));
      }
      if (url.pathname === "/rest/v1/rpc/list_student_events") {
        assert.equal(request.method, "POST");
        const body = await request.json() as Record<string, unknown>;
        eventCalls.push(body);
        const rows = events.filter((event) =>
          event.workspace_id === body.target_workspace &&
          (body.p_student_id == null ||
            event.student_ids.includes(String(body.p_student_id)))
        );
        return Response.json(rows.map((event) => ({
          ...event,
          total_count: rows.length,
        })));
      }
      throw new Error(`unexpected upstream path: ${url.pathname}`);
    };
    Deno.serve = ((callback: typeof handler) => {
      handler = callback;
      return {} as Deno.HttpServer;
    }) as typeof Deno.serve;
    await import("./index.ts");
    Deno.serve = originalServe;
    assert.ok(handler, "Edge Function did not install its handler");

    await test.step("an exact name resolves only the active profile in this workspace", async () => {
      reset([
        otherProfile,
        { ...currentProfile, student_id: "student-similar", name: `${studentName}同学` },
        { ...currentProfile, student_id: "student-deleted", deleted_at: "2026-11-01T00:00:00Z" },
        currentProfile,
      ]);
      const { response, body } = await getEvents({ student: studentName });
      assert.equal(response.status, 200);
      assert.equal(profileQueries.length, 1);
      assert.equal(profileQueries[0].searchParams.get("workspace_id"), `eq.${workspaceId}`);
      assert.equal(profileQueries[0].searchParams.get("name"), `eq.${studentName}`);
      assert.equal(profileQueries[0].searchParams.get("deleted_at"), "is.null");
      assert.equal(eventCalls.length, 1);
      assert.equal(eventCalls[0].target_workspace, workspaceId);
      assert.equal(eventCalls[0].p_student_id, studentId);
      assert.equal(body.ok, true);
      assert.equal(body.total, 1);
      assert.deepEqual(body.record_ids, ["event-current"]);
      assert.deepEqual(body.records[0].student_ids, [studentId]);
      assert.equal(body.external_send, false);
    });

    await test.step("two active students with the same name return no events without calling the RPC", async () => {
      reset([currentProfile, { ...currentProfile, student_id: "student-duplicate" }]);
      assertEmpty(await getEvents({ student: studentName }));
      assert.equal(profileQueries.length, 1);
    });

    await test.step("an unknown name returns no events without calling the RPC", async () => {
      reset([currentProfile]);
      assertEmpty(await getEvents({ student: "不存在的学生" }));
      assert.equal(profileQueries.length, 1);
    });

    await test.step("a name prefix does not resolve a different student's profile", async () => {
      reset([{ ...currentProfile, name: `${studentName}同学` }]);
      assertEmpty(await getEvents({ student: studentName }));
      assert.equal(profileQueries[0].searchParams.get("name"), `eq.${studentName}`);
    });

    await test.step("a profile found only in another workspace cannot trigger an event read", async () => {
      reset([otherProfile]);
      assertEmpty(await getEvents({ student: studentName }));
      assert.equal(profileQueries.length, 1);
      assert.equal(profileQueries[0].searchParams.get("workspace_id"), `eq.${workspaceId}`);
    });

    await test.step("explicit student_id takes precedence over a different student's name", async () => {
      reset([currentProfile]);
      const { response, body } = await getEvents({
        student_id: explicitStudentId,
        student: studentName,
      });
      assert.equal(response.status, 200);
      assert.equal(profileQueries.length, 0, "explicit ID should not require name resolution");
      assert.equal(eventCalls.length, 1);
      assert.equal(eventCalls[0].target_workspace, workspaceId);
      assert.equal(eventCalls[0].p_student_id, explicitStudentId);
      assert.deepEqual(body.record_ids, ["event-explicit"]);
      assert.deepEqual(body.records[0].student_ids, [explicitStudentId]);
      assert.equal(body.total, 1);
    });

    for (const [parameter, maxLength] of [["student", 240], ["student_id", 160]] as const) {
      for (const [label, value] of [
        ["empty", ""],
        ["whitespace-only", "   "],
        ["too long", "a".repeat(maxLength + 1)],
        ["control character", "student\u0000"],
      ]) {
        await test.step(`${parameter} rejects ${label} input with 400 without reading events`, async () => {
          reset([currentProfile]);
          const { response, body } = await getEvents({ [parameter]: value });
          assert.equal(response.status, 400, "invalid filter must not become an unfiltered list");
          assert.equal(body.code, "invalid_request");
          assert.equal(eventCalls.length, 0, "invalid filter reached the event RPC");
          assert.equal(profileQueries.length, 0, "invalid filter reached name resolution");
        });
      }
    }

    await test.step("a student name at the length limit remains a valid exact filter", async () => {
      const name = "a".repeat(240);
      reset([{ ...currentProfile, name }]);
      const { response, body } = await getEvents({ student: name });
      assert.equal(response.status, 200);
      assert.equal(profileQueries[0].searchParams.get("name"), `eq.${name}`);
      assert.equal(eventCalls.length, 1);
      assert.equal(eventCalls[0].p_student_id, studentId);
      assert.deepEqual(body.record_ids, ["event-current"]);
    });

    await test.step("an explicit student_id at the length limit remains valid", async () => {
      reset([]);
      const id = "a".repeat(160);
      const { response } = await getEvents({ student_id: id });
      assert.equal(response.status, 200);
      assert.equal(profileQueries.length, 0);
      assert.equal(eventCalls.length, 1);
      assert.equal(eventCalls[0].p_student_id, id);
      assert.equal(eventCalls[0].target_workspace, workspaceId);
    });

    await test.step("omitting both student filters still lists events in the requested workspace", async () => {
      reset([]);
      const { response, body } = await getEvents();
      assert.equal(response.status, 200);
      assert.equal(profileQueries.length, 0);
      assert.equal(eventCalls.length, 1);
      assert.equal(eventCalls[0].target_workspace, workspaceId);
      assert.equal(eventCalls[0].p_student_id, null);
      assert.deepEqual(body.record_ids, ["event-current", "event-explicit"]);
      assert.equal(body.total, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
