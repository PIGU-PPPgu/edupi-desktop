import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { commandAckLossFetch } from "./test-edupi-cloud-material-ack-loss.mjs";

async function fixture(t, status = 200) {
  const writes = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    writes.push(body);
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ request_id: body.envelope.request_id,
      receipt: { payload: { status: "accepted", applied_ids: ["synthetic-material"] } } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { writes, url: `http://127.0.0.1:${server.address().port}/functions/v1/edupi-core-broker` };
}
const command = () => ({
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ operation: "command", envelope: {
    request_id: "synthetic-request", command: { material: { material_id: "synthetic-material" } },
  } }),
});

test("ACK loss happens once, after a real HTTP write and the complete response body", async t => {
  const f = await fixture(t);
  let observed;
  const loss = commandAckLossFetch("synthetic-material", value => { observed = value; });
  await assert.rejects(loss.fetchImpl(f.url, command()), /synthetic ACK loss/);
  assert.equal(f.writes.length, 1);
  assert.equal(observed.bodyConsumed, true);
  assert.equal(observed.status, 200);
  assert.deepEqual(observed.envelope, f.writes[0].envelope);
  assert.equal(loss.dropped, true);
  const second = await loss.fetchImpl(f.url, command());
  assert.equal(second.ok, true);
  assert.equal((await second.json()).request_id, "synthetic-request");
  assert.equal(f.writes.length, 2);
});

test("HTTP rejection keeps its body and never masquerades as a lost successful ACK", async t => {
  const f = await fixture(t, 403);
  const loss = commandAckLossFetch("synthetic-material", () => assert.fail("a denied command was not committed"));
  const response = await loss.fetchImpl(f.url, command());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).request_id, "synthetic-request");
  assert.equal(loss.dropped, false);
});
