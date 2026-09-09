import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { readStudentObservationPrefix } = await createJiti(import.meta.url).import("./useStudentObservationRows.ts");

test("student observation pages load only the needed prefix and retain prior pages", async () => {
  const original = globalThis.fetch, offsets = [];
  const records = Array.from({ length: 45 }, (_, id) => ({ id: String(id), summary: `记录${id}` }));
  globalThis.fetch = async url => {
    const query = new URL(url, "http://localhost").searchParams;
    assert.equal(query.get("kind"), "learning");
    assert.equal(query.get("query"), "数学");
    const offset = Number(query.get("offset")); offsets.push(offset);
    return { ok: true, json: async () => ({ ok: true, total: records.length, records: records.slice(offset, offset + 20) }) };
  };
  try {
    const signal = new AbortController().signal;
    const first = await readStudentObservationPrefix("learning", "数学", 8, { records: [], total: null }, signal);
    assert.equal(first.records.length, 20); assert.equal(first.total, 45);
    const second = await readStudentObservationPrefix("learning", "数学", 16, first, signal);
    assert.deepEqual(offsets, [0]);
    const third = await readStudentObservationPrefix("learning", "数学", 24, second, signal);
    assert.deepEqual(offsets, [0, 20]); assert.equal(third.records.length, 40);
    assert.deepEqual(third.records.slice(0, 20), first.records);
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(readStudentObservationPrefix("learning", "数学", 48, third, signal), /读取失败/);
  } finally { globalThis.fetch = original; }
});
