import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createJiti} from "jiti";
const jiti=createJiti(import.meta.url,{jsx:{runtime:"automatic"},tsconfigPaths:true});
const {EduPiStudentWorkspace}=await jiti.import("./EduPiStudentWorkspace.tsx");
const {buildEducationContract}=await jiti.import("../lib/edupi-education-contract.ts");

test("a deleted namesake's name-only memory is not reassigned to the survivor",()=>{
  const data=buildEducationContract({workspace:"/tmp/test",students:[{student_id:"b",name:"张三",updated_at:"2026-09-08T00:00:00Z"}]});
  data.studentNameCounts={张三:2};
  data.continuity.memories=[{id:"memory-a",student:"张三",content:"A的独有记录",state:"active",tags:[],revision:0}];
  const render=()=>renderToStaticMarkup(React.createElement(EduPiStudentWorkspace,{mode:"homeroom",data,context:null,query:"",selectedStudentId:"b",onStudent(){},onEducation(){},onTask(){},onStartAgent(){},async onDeleteEntity(){return true;}}));
  assert.doesNotMatch(render(),/A的独有记录/);
  data.continuity.memories=[{...data.continuity.memories[0],student:"b",content:"B按ID的记录"}];
  assert.match(render(),/B按ID的记录/);
});
