"use client";
import { useEffect, useState } from "react";
import type { StudentEvent } from "@/lib/edupi-student-events";
import {EduPiStudentGraph} from "./EduPiStudentGraph";
import {buildStudentGraph} from "@/lib/edupi-student-graph";

export function EduPiStudentEvents({student,onAgent}:{student:string|null;onAgent:(prompt:string,mode?:"insert"|"replace")=>void}){
  const [kind,setKind]=useState("learning");const [page,setPage]=useState(0);
  const [view,setView]=useState("list");const [selectedRecord,setSelectedRecord]=useState<string|null>(null);
  useEffect(()=>setSelectedRecord(null),[student,kind,page]);
  const [records,setRecords]=useState<StudentEvent[]>([]);const [total,setTotal]=useState(0);
  const [refresh,setRefresh]=useState(0);const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(true);
  const [editing,setEditing]=useState<StudentEvent|null>(null);const [deleting,setDeleting]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  useEffect(()=>{const changed=()=>setRefresh(value=>value+1);window.addEventListener("edupi-student-records-changed",changed);return()=>window.removeEventListener("edupi-student-records-changed",changed);},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(null);setRecords([]);setTotal(0);
    const query=new URLSearchParams({kind,offset:String(page*20),...(student?{student}:{})});
    fetch(`/api/edupi/student-events?${query}`,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(result.error||"读取失败");
      if(!controller.signal.aborted){setRecords(result.records);setTotal(result.total);setSelectedRecord(current=>buildStudentGraph(result.records).records.some(record=>record.id===current)?current:null);}
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[student,kind,page,refresh]);
  const save=async(item:StudentEvent,action:"update_event"|"delete_event")=>{
    setBusy(true);setError(null);
    try{
      const body={action,event_id:item.id,expected_revision:item.revision,...(action==="update_event"?{summary:item.summary,topic:item.topic,observed_on:item.observed_on}:{})};
      const response=await fetch("/api/edupi/student-events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"保存失败");
      setEditing(null);setDeleting(null);setRefresh(value=>value+1);
      if(action==="delete_event")setSelectedRecord(null);
    }catch(reason){setError(reason instanceof Error?reason.message:"保存失败");}finally{setBusy(false);}
  };
  return <section className="edupi-student-events" aria-label="学生学习与互动记录">
    <header><div role="group" aria-label="记录类型">{[["learning","学习表现"],["interaction","同伴互动"]].map(([value,label])=><button key={value} type="button" aria-pressed={kind===value} onClick={()=>{setKind(value);setPage(0);setEditing(null);}}>{label}</button>)}</div><button type="button" onClick={()=>onAgent(`请帮我记录${student?student:"学生"}的${kind==="learning"?"学习表现":"同伴互动"}，使用学生记录工具保存。\n\n我观察到（在这里输入或口述）：`,"replace")}>对话记录</button></header>
    {error?<p role="alert">{error}<button type="button" onClick={()=>setRefresh(value=>value+1)}>重试</button></p>:null}
    <div className="edupi-student-graph-toggle" role="group" aria-label="记录视图">{[["list","列表"],["graph","局部图"]].map(([value,label])=><button key={value} type="button" aria-pressed={view===value} onClick={()=>{setView(value);setSelectedRecord(null);setEditing(null);}}>{label}</button>)}</div>
    {!loading&&records.length>0&&view==="graph"?<EduPiStudentGraph records={records} selectedId={selectedRecord} onSelect={setSelectedRecord}/>:null}
    {loading?<p role="status">读取中…</p>:records.length===0?<p>暂无记录</p>:(view==="graph"?records.filter(record=>record.id===selectedRecord):records).map(item=><article key={item.id}>
      <header><strong>{item.students.join("、")}</strong><time>{item.observed_on||"日期未明确"}</time></header>
      {editing?.id===item.id?<form onSubmit={event=>{event.preventDefault();void save(editing,"update_event");}}><label>内容<textarea value={editing.summary} maxLength={2000} required rows={3} onChange={event=>setEditing({...editing,summary:event.target.value})}/></label><label>知识点<input value={editing.topic||""} maxLength={120} onChange={event=>setEditing({...editing,topic:event.target.value})}/></label><label>日期<input type="date" value={editing.observed_on||""} onChange={event=>setEditing({...editing,observed_on:event.target.value||null})}/></label><button disabled={busy} type="submit">保存</button><button disabled={busy} type="button" onClick={()=>setEditing(null)}>取消</button></form>:<><p>{item.summary}</p>{item.topic?<small>{item.topic}</small>:null}<div className="edupi-student-events__actions"><button type="button" onClick={()=>setEditing(item)}>修改</button><button type="button" onClick={()=>setDeleting(item.id)}>删除</button></div></>}
      {deleting===item.id?<div><span>删除这条记录？</span><button disabled={busy} type="button" onClick={()=>void save(item,"delete_event")}>确认删除</button><button type="button" onClick={()=>setDeleting(null)}>取消</button></div>:null}
      <details><summary>原始对话</summary><p>{item.source.text}</p><a href={`/?edupi=1&module=home&view=chat&inspector=0&session=${encodeURIComponent(item.source.session_id)}`}>打开对话</a></details>
      {item.history.length?<details><summary>最近修改</summary>{item.history.map(version=><p key={version.revision}>{version.summary}</p>)}</details>:null}
    </article>)}
    <footer><button type="button" disabled={page===0||loading} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(total/20))}</span><button type="button" disabled={(page+1)*20>=total||loading} onClick={()=>setPage(value=>value+1)}>下一页</button></footer>
  </section>;
}
