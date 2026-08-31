import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const recognition = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-recognition.ts");

const descriptor = {
  staging_id: "stg_00000000000000000000000000000001",
  staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000001/material.pdf",
  original_name: "第一学期校历.pdf",
  expected_size_bytes: 128,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "pdf",
  source_scope: "desktop_staging",
};

function docxDirectory(uncompressedSize) {
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(uncompressedSize, 24);
  central.writeUInt16LE(1, 28);
  central[46] = 0x61;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(0, 16);
  return Buffer.concat([central, end]);
}

test("parses only bounded calendar and timetable fields and keeps uncertain dates unguessed", () => {
  let nextId = 0;
  const result = recognition.parseRecognitionOutput(`\n\`\`\`json\n${JSON.stringify({
    events: [
      { date: "2026-09-01", end_date: null, name: "开学", type: "teaching", notes: "校历原文" },
      { date: "十月下旬（日期待确认）", end_date: null, name: "运动会", type: "activity", notes: null },
    ],
    slots: [
      { day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null },
    ],
  })}\n\`\`\``, () => `recognized-${++nextId}`);
  assert.deepEqual(result.events, [
    { event_id: "recognized-1", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: "校历原文" },
    { event_id: "recognized-2", date: "十月下旬（日期待确认）", end_date: null, name: "运动会", type: "activity", confidence: "inferred", notes: null },
  ]);
  assert.deepEqual(result.slots, [
    { slot_id: "recognized-3", day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null },
  ]);
});

test("rejects prose, unknown fields, invalid slot bounds, and oversized results", () => {
  for (const output of [
    "没有识别到日程",
    JSON.stringify({ events: [], slots: [], explanation: "extra" }),
    JSON.stringify({ events: [], slots: [{ day_of_week: 8, period: 1, subject: "数学", class_name: null, kind: "class", notes: null }] }),
    JSON.stringify({ events: Array.from({ length: 201 }, (_, index) => ({ date: "2026-09-01", end_date: null, name: `事件${index}`, type: "custom", notes: null })), slots: [] }),
  ]) assert.throws(() => recognition.parseRecognitionOutput(output), (error) => error?.code === "invalid_output");
});

test("normalizes common Chinese date, type, weekday, period, and slot-kind output", () => {
  let nextId = 0;
  const result = recognition.parseRecognitionOutput(JSON.stringify({
    events: [{ date: "2026年9月1日", end_date: "", name: "开学", type: "开学", notes: "" }],
    slots: [{ day_of_week: "周一", period: "第1节", subject: "数学", class_name: "七年级二班", kind: "课程", notes: "" }],
  }), () => `cn-${++nextId}`);
  assert.deepEqual(result.events[0], { event_id: "cn-1", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: null });
  assert.deepEqual(result.slots[0], { slot_id: "cn-2", day_of_week: 1, period: 1, subject: "数学", class_name: "七年级二班", kind: "class", notes: null });
});

test("recognizes extracted source content without sending staging ids or hashes to the model", async () => {
  let modelInput;
  const result = await recognition.recognizeStagedMaterial(descriptor, {
    idFactory: (() => { let index = 0; return () => `item-${++index}`; })(),
    extract: async () => ({ text: "2026年9月1日开学", images: [] }),
    runModel: async (input) => {
      modelInput = input;
      return JSON.stringify({ events: [{ date: "2026-09-01", end_date: null, name: "开学", type: "teaching", notes: null }], slots: [] });
    },
  });
  assert.equal(modelInput.originalName, "第一学期校历.pdf");
  assert.equal(modelInput.text, "2026年9月1日开学");
  assert.equal(JSON.stringify(modelInput).includes("stg_"), false);
  assert.equal(JSON.stringify(modelInput).includes("sha256"), false);
  assert.equal(result.events[0].event_id, "item-1");
  assert.equal(result.events[0].confidence, "inferred");
});

test("returns an empty recognition result for a material with no schedule facts", async () => {
  const result = await recognition.recognizeStagedMaterial(descriptor, {
    extract: async () => ({ text: "普通课堂反思，没有日期或课表", images: [] }),
    runModel: async () => JSON.stringify({ events: [], slots: [] }),
  });
  assert.deepEqual(result, { events: [], slots: [] });
});

test("rejects malformed and decompression-bomb DOCX archives before mammoth runs", () => {
  assert.doesNotThrow(() => recognition.validateDocxArchive(docxDirectory(1024)));
  assert.throws(() => recognition.validateDocxArchive(docxDirectory(80 * 1024 * 1024)), (error) => error?.code === "too_large");
  assert.throws(() => recognition.validateDocxArchive(Buffer.from("PK bad")), (error) => error?.code === "extract_unavailable");
});

test("runs DOCX expansion in a bounded child process instead of the server process", () => {
  const source = fs.readFileSync(new URL("./edupi-material-recognition.ts", import.meta.url), "utf8");
  assert.match(source, /`--max-old-space-size=\$\{DOCX_WORKER_HEAP_MB\}`/);
  assert.match(source, /timeout: DOCX_WORKER_TIMEOUT_MS/);
  assert.match(source, /withPrivateSnapshot\(bytes, extension, extractDocxText\)/);
  assert.doesNotMatch(source, /mammoth\.extractRawText\(\{ buffer: bytes \}\)/);
});

test("pins recognition bytes to the private staging root and rejects swaps or symlinks", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "edupi-recognition-boundary-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  const stagingId = "stg_30000000000000000000000000000001";
  const directory = path.join(root, "material-staging", stagingId);
  const file = path.join(directory, "material.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, bytes);
  process.env.PI_DESKTOP_STATE_DIR = root;
  const boundaryDescriptor = { ...descriptor, staging_id: stagingId, staging_path: file, original_name: "校历.png", expected_size_bytes: bytes.length, source_hash: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, kind: "image" };
  try {
    assert.deepEqual((await recognition.readVerifiedStagedMaterial(boundaryDescriptor)).bytes, bytes);
    const cachedResult = { events: [{ event_id: "cached-event", date: "2026-09-01", end_date: null, name: "开学", type: "teaching", confidence: "inferred", notes: null }], slots: [] };
    recognition.saveRecognitionCache(boundaryDescriptor, cachedResult);
    assert.deepEqual(recognition.loadRecognitionCache(boundaryDescriptor), cachedResult);
    fs.writeFileSync(file, Buffer.alloc(bytes.length, 0x61));
    await assert.rejects(recognition.readVerifiedStagedMaterial(boundaryDescriptor), (error) => error?.code === "extract_unavailable");
    await assert.rejects(recognition.recognizeStagedMaterial(boundaryDescriptor), (error) => error?.code === "extract_unavailable");
    fs.unlinkSync(file);
    const outside = path.join(root, "outside.png");
    fs.writeFileSync(outside, bytes);
    fs.symlinkSync(outside, file);
    await assert.rejects(recognition.readVerifiedStagedMaterial(boundaryDescriptor), (error) => error?.code === "extract_unavailable");
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
