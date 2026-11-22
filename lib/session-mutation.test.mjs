import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { mutateSession } = await createJiti(import.meta.url).import("./session-mutation.ts");
const scope = JSON.stringify(["cloud", "https://synthetic.invalid", "teacher", "workspace", 4]);
const session = { id: "cloud-one", cwd: "cloud:workspace", cloudScope: scope };

for (const change of [{ name: "新标题" }, null]) {
  test(`session ${change ? "rename" : "delete"} sends the scope of the displayed row`, async () => {
    let call;
    assert.equal(await mutateSession(session, change, async (url, options) => {
      call = { url, ...options }; return Response.json({ ok: true });
    }), "applied");
    assert.equal(call.headers.get("x-edupi-cloud-scope"), scope);
    assert.equal(call.method, change ? "PATCH" : "DELETE");
    if (change) assert.deepEqual(JSON.parse(call.body), change);
  });
  test(`session ${change ? "rename" : "delete"} keeps pending separate from successful completion`, async () => {
    assert.equal(await mutateSession(session, change, async () =>
      Response.json({ ok: false, queued: true, pendingSync: true }, { status: 202 })), "pending");
  });
}
test("failed or malformed writes cannot remove a row or confirm a saved title", async () => {
  for (const [body, status] of [[{ error: "登录已失效" }, 401], [{ error: "工作区已改变" }, 409], [{}, 200], [{ ok: true }, 202]]) {
    await assert.rejects(mutateSession(session, null, async () => Response.json(body, { status })));
  }
  await assert.rejects(mutateSession(session, null, async () => { throw new TypeError("offline"); }), /offline/);
});
test("an old cloud row without an identity is refused instead of inheriting the current account", async () => {
  await assert.rejects(mutateSession({ id: "one", cwd: "cloud:workspace" }, null,
    async () => assert.fail("must not fetch")), /刷新/);
});
test("local row writes remain explicitly local", async () => {
  await mutateSession({ id: "local", cwd: "/synthetic" }, null, async (_url, options) => {
    assert.equal(options.headers.get("x-edupi-cloud-scope"), "local");
    return Response.json({ ok: true });
  });
});
