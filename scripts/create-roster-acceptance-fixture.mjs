// Disposable UI input for roster importer acceptance; never use real student data.
import fs from "node:fs";
import path from "node:path";
import { utils, write } from "xlsx";
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) throw new Error("Pass an absolute temporary output directory");
fs.mkdirSync(directory, { recursive: true });
for (const [extension, bookType] of [["xlsx", "xlsx"], ["xls", "biff8"]]) {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["隔离导入验收"]]), "说明");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["姓名", "班级"], [`表格验收${extension}`, "表格验收班"]]), "名单");
  const file = path.join(directory, `名单.${extension}`);
  fs.writeFileSync(file, write(workbook, { type: "buffer", bookType }));
  console.log(file);
}
