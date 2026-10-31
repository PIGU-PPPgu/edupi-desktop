import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url,{jsx:{runtime:"automatic"},tsconfigPaths:true});
const {EduPiDossierRecordTable,dossierRecordsCsv}=await jiti.import("./EduPiDossierRecordTable.tsx");
const rows=[{id:"old",title:"合成旧观察",date:"2026-09-01",note:"",kind:"attention"},{id:"new",title:"合成新进展",date:"2026-10-31",note:"教师记录",kind:"growth"},{id:"undated",title:"日期尚未记录",date:null,note:"",kind:"resolved"}];
test("record table sorts dated source records and leaves unknown dates unknown",()=>{
 const html=renderToStaticMarkup(React.createElement(EduPiDossierRecordTable,{rows}));
 assert.ok(html.indexOf("合成新进展")<html.indexOf("合成旧观察"));
 assert.ok(html.indexOf("合成旧观察")<html.indexOf("日期尚未记录"));
 assert.match(html,/日期未记录/);assert.match(html,/筛选档案记录/);assert.match(html,/导出 CSV/);
});
test("CSV quotes source text and neutralizes formula-prefixed cells",()=>{
 const csv=dossierRecordsCsv([{id:"x",title:'=SUM(1,2)',date:null,note:'两行\n带"引号"',kind:"attention",studentName:"+合成"}]);
 assert.ok(csv.startsWith("\uFEFF"));assert.ok(csv.includes('"\'=SUM(1,2)"'));assert.ok(csv.includes('"\'+合成"'));assert.ok(csv.includes('带""引号""'));
 assert.ok(csv.endsWith("\r\n"));
});
