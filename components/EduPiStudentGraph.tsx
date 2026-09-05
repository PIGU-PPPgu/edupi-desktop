"use client";
import {useState} from "react";
import type {StudentEvent} from "@/lib/edupi-student-events";
import {buildStudentGraph} from "@/lib/edupi-student-graph";

export function EduPiStudentGraph({records,selectedId,onSelect}:{records:StudentEvent[];selectedId:string|null;onSelect:(id:string)=>void}){
  const graph=buildStudentGraph(records);const [focus,setFocus]=useState<string|null>(null);
  const focused=graph.nodes.find(node=>node.id===focus);
  const columns=["student","record","topic"] as const;
  const height=Math.max(180,...columns.map(kind=>graph.nodes.filter(node=>node.kind===kind).length*62+30));
  const positions=new Map<string,{x:number;y:number}>();
  columns.forEach((kind,column)=>graph.nodes.filter(node=>node.kind===kind).forEach((node,index)=>positions.set(node.id,{x:20+column*270,y:20+index*62})));
  return <div className="edupi-student-graph">
    <div className="edupi-student-graph__legend"><span>学生</span><span>学习 / 互动记录</span><span>知识点</span></div>
    <div className="edupi-student-graph__viewport"><div className="edupi-student-graph__canvas" style={{height}}>
      <svg width="760" height={height} aria-label="记录关联线">{graph.edges.map((edge,index)=>{
        const from=positions.get(edge.from)!;const to=positions.get(edge.to)!;
        const d=`M${from.x+180},${from.y+21} C${from.x+225},${from.y+21} ${to.x-45},${to.y+21} ${to.x},${to.y+21}`;
        return <g key={index} role="button" tabIndex={0} aria-label={`查看关联记录 ${graph.records.findIndex(record=>record.id===edge.recordId)+1}`} onClick={()=>onSelect(edge.recordId)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect(edge.recordId);}}} className={selectedId===edge.recordId?"is-selected":""}><circle cx={(from.x+180+to.x)/2} cy={(from.y+to.y)/2+21} r={7} fill="transparent"/><path d={d} className="edupi-student-graph__hit"/><path d={d} className="edupi-student-graph__edge"/></g>;
      })}</svg>
      {graph.nodes.map(node=>{const p=positions.get(node.id)!;return <button key={node.id} type="button" title={node.label} className={`edupi-student-graph__node is-${node.kind}`} style={{left:p.x,top:p.y}} aria-pressed={node.kind==="record"?selectedId===node.recordIds[0]:focus===node.id} onClick={()=>{if(node.kind==="record")onSelect(node.recordIds[0]);else setFocus(focus===node.id?null:node.id);}}>{node.kind==="record"?<><small>记录 {graph.records.findIndex(record=>record.id===node.recordIds[0])+1}</small><span>{node.label}</span></>:<span>{node.label}</span>}</button>;})}
    </div></div>
    <small>本页局部图 · {graph.records.length} / {records.length} 条记录</small>
    {focused?<div className="edupi-student-graph__related"><strong>{focused.label}</strong>{graph.records.filter(record=>focused.recordIds.includes(record.id)).map(record=><button key={record.id} type="button" onClick={()=>onSelect(record.id)}>{record.summary}</button>)}</div>:null}
  </div>;
}
