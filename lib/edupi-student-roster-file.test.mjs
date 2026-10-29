import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { utils, write } from "xlsx";

const { parseStudentRosterFile, previewStudentRosterFile, classifyStudentRosterFile } = await createJiti(import.meta.url).import("./edupi-student-roster-file.ts");
const rows = [["七年级703班学生名单"], ["学号", "姓名", "性格特征", "家长备注"], ["001", "蔡静然", "认真、沉稳", "及时沟通"], ["002", "欧阳锋", "活跃", "关注作息"]];

function workbookBytes(bookType) {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["说明"]]), "说明");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), "703班");
  return new Uint8Array(write(workbook, { type: "buffer", bookType }));
}

for (const [name, type] of [["703班学生名单.xlsx", "xlsx"], ["703班学生名单.xls", "biff8"]]) {
  test(`imports ${name} and selects the worksheet containing 姓名`, () => {
    assert.deepEqual(parseStudentRosterFile(workbookBytes(type), name), [
      { name: "蔡静然", traits: ["认真", "沉稳"], parentNotes: ["及时沟通"] },
      { name: "欧阳锋", traits: ["活跃"], parentNotes: ["关注作息"] },
    ]);
  });
}

test("rejects unsupported roster formats", () => {
  assert.throws(() => parseStudentRosterFile(new TextEncoder().encode("姓名\n李四"), "名单.pdf"), (error) => error.code === "invalid_csv");
});

test("preview retains title rows and sheets so the teacher can map columns", () => {
  const sheets = previewStudentRosterFile(workbookBytes("xlsx"), "名单.xlsx");
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["说明", "703班"]);
  assert.equal(sheets[1].rows[1][1], "姓名");
  assert.equal(sheets[1].rows[2][0], "001");
});

test("preview accepts unknown header names and preserves Chinese CSV text", () => {
  const sheets = previewStudentRosterFile(new TextEncoder().encode("人员,说明\n测试学生,认真"), "名单.csv");
  assert.deepEqual(sheets[0].rows, [["人员", "说明"], ["测试学生", "认真"]]);
});

test("automatic classification imports only one unambiguous roster sheet", () => {
  const simpleBook = utils.book_new();
  utils.book_append_sheet(simpleBook, utils.aoa_to_sheet([["说明"]]), "说明");
  utils.book_append_sheet(simpleBook, utils.aoa_to_sheet([["姓名", "班级"], ["蔡静然", "703班"], ["欧阳锋", "703班"]]), "703班");
  const result = classifyStudentRosterFile(new Uint8Array(write(simpleBook, {type:"buffer",bookType:"xlsx"})), "名单.xlsx");
  assert.equal(result.status, "ready");
  assert.equal(result.students.length, 2);
  assert.equal(classifyStudentRosterFile(workbookBytes("xlsx"), "名单.xlsx").status, "needs_review");
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), "703班");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["姓名"], ["合成学生乙"]]), "704班");
  const ambiguous = classifyStudentRosterFile(new Uint8Array(write(workbook, {type:"buffer",bookType:"xlsx"})), "两张名单.xlsx");
  assert.equal(ambiguous.status, "needs_review");
  assert.equal(ambiguous.sheets.length, 2);
});

test("automatic classification holds unknown, duplicate and invalid columns without writing", () => {
  for (const content of ["人员,班级\n合成学生甲,一班", "姓名,学生姓名\n合成学生甲,合成学生乙", "姓名,家长电话\n合成学生甲,123456", "姓名,班级\n合成学生甲,一班\n合成学生甲,一班"]) {
    const result = classifyStudentRosterFile(new TextEncoder().encode(content), "名单.csv");
    assert.equal(result.status, "needs_review");
    assert.ok(result.reason);
  }
});

test("automatic classification holds summary and teacher footer rows for review", () => {
  for (const content of [
    "姓名,班级\n张三,一班\n李四,一班\n合计,2人\n",
    "姓名,班级\n张三,一班\n班主任,王老师\n",
    "姓名,班级\n张三,一班\n备注：以下名单待核对,\n",
    "姓名,班级\n张三,一班\n统计2人,\n",
    "姓名,班级\n张三,一班\n合 计,1人\n",
    "姓名,班级\n张三,一班\n合计（2人）,\n",
    "姓名,班级\n张三,一班\n班主任 王老师,\n",
    "姓名,班级\n张三,一班\n姓名,班级\n",
    "姓名,班级\n张三,一班\n共 1 人,\n",
    "姓名,班级\n张三,一班\n123,一班\n",
  ]) assert.equal(classifyStudentRosterFile(new TextEncoder().encode(content), "名单.csv").status, "needs_review");
  assert.equal(classifyStudentRosterFile(new TextEncoder().encode("姓名,班级\n张三,一班\n李四,一班\n"), "名单.csv").status, "ready");
});

test("automatic classification holds data in unmapped or blank-header columns", () => {
  for (const content of [
    "姓名,班级,\n张三,一班,13800000000\n",
    "姓名,班级,学号\n张三,一班,001\n",
    "姓名,班级\n张三,一班,额外内容\n",
  ]) assert.equal(classifyStudentRosterFile(new TextEncoder().encode(content), "名单.csv").status, "needs_review");
});

test("preview rejects oversized sheet ranges rather than silently importing a truncated roster", () => {
  const wb = utils.book_new();
  const sheet = utils.aoa_to_sheet([["姓名"], ["测试学生"]]);
  sheet["!ref"] = "A1:A1000";
  utils.book_append_sheet(wb, sheet, "名单");
  assert.throws(() => previewStudentRosterFile(new Uint8Array(write(wb, {type: "buffer", bookType: "xlsx"})), "名单.xlsx"), /过大/);
});
