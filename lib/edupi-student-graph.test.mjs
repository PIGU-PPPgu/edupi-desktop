import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
const {buildStudentGraph}=await createJiti(import.meta.url).import("./edupi-student-graph.ts");
test("namesakes remain separate graph nodes through student IDs",()=>{
  const graph=buildStudentGraph([{id:"namesakes",kind:"interaction",students:["张三","张三"],student_ids:["student-a","student-b"],student_labels:["张三 · A","张三 · B"],summary:"共同讨论移项",topic:"移项"}]);
  const students=graph.nodes.filter(node=>node.kind==="student");
  assert.equal(students.length,2);
  assert.deepEqual(students.map(node=>node.id),["student:student-a","student:student-b"]);
  assert.deepEqual(students.map(node=>node.label),["张三 · A","张三 · B"]);
});
test("shared interactions use one event node instead of inventing pairwise friendships",()=>{
  const graph=buildStudentGraph([{id:"one",kind:"interaction",students:["甲","乙","丙"],summary:"共同完成小组练习",topic:"移项"}]);
  assert.equal(graph.nodes.filter(n=>n.kind==="record").length,1);assert.equal(graph.edges.length,4);
  assert.ok(graph.edges.every(e=>e.from.startsWith("record:")||e.to.startsWith("record:")));
  assert.ok(graph.edges.every(e=>e.recordId==="one"));
});
test("local graph is bounded without dropping participants from included events",()=>{
  const records=Array.from({length:20},(_,i)=>({id:String(i),students:[`学生${i}`],summary:"学习记录",topic:"移项"}));
  assert.equal(buildStudentGraph(records).records.length,20);
  const large=buildStudentGraph([{id:"a",students:Array.from({length:20},(_,i)=>`甲${i}`),summary:"小组"},{id:"b",students:Array.from({length:20},(_,i)=>`乙${i}`),summary:"小组"}]);
  assert.equal(large.records.length,2);assert.equal(large.nodes.filter(n=>n.kind==="student").length,40);
});
