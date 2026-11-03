import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../../../../../lib/session-reader.ts");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9l0AAAAASUVORK5CYII=";

test("deferred tool image is served from its exact session entry", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-deferred-image-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const file = path.join(root, "session.jsonl");
  t.after(() => { invalidateSessionPathCache(id); fs.rmSync(root, { recursive: true, force: true }); });
  const now = new Date().toISOString();
  const rows = [
    { type: "session", version: 3, id, timestamp: now, cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: now, message: { role: "user", content: "扫码" } },
    { type: "message", id: "tr1", parentId: "u1", timestamp: now, message: { role: "toolResult", toolCallId: "call1", content: [{ type: "text", text: "二维码" }, { type: "image", data: png, mimeType: "image/png" }] } },
  ];
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  cacheSessionPath(id, file);
  const params = Promise.resolve({ id, entryId: "tr1" });
  const ok = await GET(new Request(`http://localhost/api/sessions/${id}/entries/tr1/image?blockIndex=1`), { params });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), Buffer.from(png, "base64"));
  const missing = await GET(new Request(`http://localhost/api/sessions/${id}/entries/tr1/image?blockIndex=0`), { params });
  assert.equal(missing.status, 404);
  const wrongEntry = await GET(new Request(`http://localhost/api/sessions/${id}/entries/u1/image?blockIndex=1`), { params: Promise.resolve({ id, entryId: "u1" }) });
  assert.equal(wrongEntry.status, 404);
});
