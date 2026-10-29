import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { processAutomaticStudentRoster, processManualStudentRoster } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../../lib/edupi-student-roster-import.ts");
const { manualRosterRequestId } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../../lib/edupi-student-roster-server.ts");
const bytes = text => new TextEncoder().encode(text);

test("manual preview confirmation reuses its request ID until the CSV mapping changes", () => {
  const first = manualRosterRequestId('"姓名","班级"\r\n"张三","一班"', "名单.xlsx");
  assert.equal(first, manualRosterRequestId('"姓名","班级"\r\n"张三","一班"', "名单.xlsx"));
  assert.notEqual(first, manualRosterRequestId('"姓名","班级"\r\n"张三","二班"', "名单.xlsx"));
  assert.notEqual(first, manualRosterRequestId('"姓名","班级"\r\n"张三","一班"', "另一份名单.xlsx"));
});

test("manual JSON flow verifies the authoritative roster before reporting success", async () => {
  const ids = [];
  const deps = {
    importRoster: async input => { ids.push(input.requestId); return { imported: input.students.length }; },
    readContract: async () => ({ students: [{ name: "张三", class_name: "一班" }] }),
  };
  const first = await processManualStudentRoster('"姓名","班级"\r\n"张三","一班"', "名单.xlsx", undefined, deps);
  const again = await processManualStudentRoster('"姓名","班级"\r\n"张三","一班"', "名单.xlsx", undefined, deps);
  await processManualStudentRoster('"姓名","班级"\r\n"张三","一班"\r\n', "名单.xlsx", undefined, deps);
  assert.equal(first.verified, true);
  assert.equal(again.verified, true);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[1], ids[2]);
});

test("automatic import has a stable request ID and reads after one Core write", async () => {
  const ids = [], calls = [];
  const deps = {
    importRoster: async input => { ids.push(input.requestId); calls.push("write"); return { imported: input.students.length }; },
    readContract: async () => { calls.push("read"); return { students: [{ name: "合成学生甲", class_name: "测试班" }, { name: "合成学生乙", class_name: "测试班" }] }; },
  };
  const file = bytes("姓名,班级\n合成学生甲,测试班");
  const first = await processAutomaticStudentRoster(file, "名单.csv", undefined, deps);
  const second = await processAutomaticStudentRoster(file, "名单.csv", undefined, deps);
  await processAutomaticStudentRoster(bytes("姓名,班级\n合成学生乙,测试班"), "名单.csv", undefined, deps);
  assert.equal(first.status, "imported");
  assert.equal(first.verified, true);
  assert.equal(second.status, "imported");
  assert.equal(first.result.imported, 1);
  assert.deepEqual(calls, ["write", "read", "write", "read", "write", "read"]);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[1], ids[2]);
});

test("a Core import receipt without matching authoritative students is not a success and is never retried", async () => {
  let writes = 0;
  const deps = {
    importRoster: async input => { writes += 1; return { imported: input.students.length }; },
    readContract: async () => ({ students: [] }),
  };
  await assert.rejects(() => processAutomaticStudentRoster(bytes("姓名,班级\n张三,一班"), "名单.csv", undefined, deps), /写入状态未确认/);
  await assert.rejects(() => processManualStudentRoster("姓名,班级\n张三,一班", "名单.csv", undefined, deps), /写入状态未确认/);
  assert.equal(writes, 2);
  const wrongClass = { ...deps, readContract: async () => ({ students: [{ name: "张三", class_name: "二班" }] }) };
  await assert.rejects(() => processManualStudentRoster("姓名,班级\n张三,一班", "名单.csv", undefined, wrongClass), /写入状态未确认/);
  assert.equal(writes, 3);
});

test("import success requires every submitted profile field on the authoritative reread", async () => {
  const csv = "姓名,班级,特征,家校备注\n张三,一班,专注、主动,家长希望每周沟通";
  const importRoster = async ({ students }) => ({ imported: students.length });
  const complete = { name: "张三", class_name: "一班", traits: ["主动", "专注", "原有特征"], parent_notes: ["家长希望每周沟通", "原有备注"] };
  const call = (students) => processManualStudentRoster(csv, "名单.csv", undefined, { importRoster, readContract: async () => ({ students }) });
  assert.equal((await call([complete])).verified, true);
  await assert.rejects(call([{ ...complete, traits: ["主动"] }]), /写入状态未确认/);
  await assert.rejects(call([{ ...complete, parent_notes: [] }]), /写入状态未确认/);
  await assert.rejects(call([complete, { ...complete }]), /写入状态未确认/);
});

test("ambiguous roster never invokes Core or the post-write read", async () => {
  let writes = 0, reads = 0;
  for (const text of [
    "人员,班级\n合成学生甲,测试班",
    "姓名,班级\n张三,一班\n李四,一班\n合计,2人\n",
    "姓名,班级\n张三,一班\n班主任,王老师\n",
    "姓名,班级\n张三,一班\n合计（2人）,\n",
    "姓名,班级\n张三,一班\n班主任 王老师,\n",
    "姓名,班级,\n张三,一班,13800000000\n",
  ]) {
    const result = await processAutomaticStudentRoster(bytes(text), "名单.csv", undefined, {
      importRoster: async () => { writes += 1; return { imported: 1 }; },
      readContract: async () => { reads += 1; return {}; },
    });
    assert.equal(result.status, "needs_review");
    assert.ok(result.sheets[0].rows.length >= 2);
  }
  assert.equal(writes, 0);
  assert.equal(reads, 0);
});
