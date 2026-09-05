import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { utils, write } from "xlsx";

const { parseStudentRosterFile, previewStudentRosterFile } = await createJiti(import.meta.url).import("./edupi-student-roster-file.ts");
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

test("preview rejects oversized sheet ranges rather than silently importing a truncated roster", () => {
  const wb = utils.book_new();
  const sheet = utils.aoa_to_sheet([["姓名"], ["测试学生"]]);
  sheet["!ref"] = "A1:A1000";
  utils.book_append_sheet(wb, sheet, "名单");
  assert.throws(() => previewStudentRosterFile(new Uint8Array(write(wb, {type: "buffer", bookType: "xlsx"})), "名单.xlsx"), /过大/);
});
