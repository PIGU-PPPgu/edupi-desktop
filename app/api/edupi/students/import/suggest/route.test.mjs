import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseSuggestionHeaders, parseRosterMappingSuggestion, suggestStudentRosterColumns } = await jiti.import("../../../../../../lib/edupi-student-roster-suggestion.ts");
const { isTeachingModelIneligible } = await jiti.import("../../../../../../lib/model-setup-presets.ts");
const { POST } = await jiti.import("./route.ts");

test("suggestion accepts only bounded header labels and no roster rows", () => {
  assert.deepEqual(parseSuggestionHeaders({ headers: [" 姓名 ", "班别"] }), ["姓名", "班别"]);
  for (const invalid of [
    { headers: ["姓名"], rows: [["合成学生甲"]] },
    { headers: [] },
    { headers: Array.from({length:101},()=>"列") },
    { headers: ["姓名", "x".repeat(121)] },
    { headers: ["姓名\n合成学生甲"] },
  ]) assert.throws(() => parseSuggestionHeaders(invalid));
});

test("model output is only a candidate mapping with unique bounded indexes", async () => {
  const headers = ["学生", "家校联络", "班别"];
  const columns = await suggestStudentRosterColumns(headers, async received => {
    assert.deepEqual(received, headers);
    return JSON.stringify({ name: 0, traits: -1, parentNotes: 1, className: 2 });
  });
  assert.deepEqual(columns, [0, -1, 1, 2]);
  for (const output of ['{"name":-1}', '{"name":0,"traits":0}', '{"name":3}', '```json\n{"name":0}\n```', '{"name":0,"extra":1}']) {
    assert.throws(() => parseRosterMappingSuggestion(output, 3));
  }
  await assert.rejects(() => suggestStudentRosterColumns(headers, async () => { throw new Error("synthetic model outage"); }), /synthetic model outage/);
});

test("coding-only and personal token plans cannot serve education backend suggestions", () => {
  for (const provider of ["zai", "zai-coding-cn", "kimi-coding", "qwen-token-plan-cn", "bailian-coding"]) {
    assert.equal(isTeachingModelIneligible(provider, "https://api.example.com/v1"), true);
  }
  assert.equal(isTeachingModelIneligible("custom", "https://coding.dashscope.aliyuncs.com/v1"), true);
  assert.equal(isTeachingModelIneligible("deepseek", "https://api.deepseek.com"), false);
});

test("invalid suggestion request is rejected before selecting or calling any model", async () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = "synthetic-desktop-token-for-roster-suggestions-123456";
  try {
  const request = new Request("http://127.0.0.1:30141/api/edupi/students/import/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "127.0.0.1:30141", Origin: "http://127.0.0.1:30141", "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN },
    body: JSON.stringify({ headers: ["姓名"], rows: [["合成学生甲"]] }),
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /表头/);
  const malformed = await POST(new Request("http://127.0.0.1:30141/api/edupi/students/import/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "127.0.0.1:30141", Origin: "http://127.0.0.1:30141", "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN },
    body: "{",
  }));
  assert.equal(malformed.status, 400);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previous;
  }
});

test("LAN and tokenless requests cannot spend the teacher's model balance", async () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = "synthetic-desktop-token-for-roster-suggestions-123456";
  try {
    for (const host of ["192.168.1.42:30141", "127.0.0.1:30141"]) {
      const request = new Request(`http://${host}/api/edupi/students/import/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Host: host },
        body: JSON.stringify({ headers: ["姓名", "班级"] }),
      });
      assert.equal((await POST(request)).status, 403);
    }
    const lanWithStolenHeader = new Request("http://192.168.1.42:30141/api/edupi/students/import/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "192.168.1.42:30141", "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN },
      body: JSON.stringify({ headers: ["姓名", "班级"] }),
    });
    assert.equal((await POST(lanWithStolenHeader)).status, 403);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
    else process.env.PI_DESKTOP_API_TOKEN = previous;
  }
});
