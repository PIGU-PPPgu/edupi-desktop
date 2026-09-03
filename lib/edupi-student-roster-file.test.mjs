import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { utils, write } from "xlsx";

const { parseStudentRosterFile } = await createJiti(import.meta.url).import("./edupi-student-roster-file.ts");
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
