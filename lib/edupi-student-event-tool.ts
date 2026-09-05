import { resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { studentEventRequest } from "./edupi-student-events";

const parameters=Type.Object({
  action:Type.Union([Type.Literal("list"),Type.Literal("record"),Type.Literal("update")]),
  student:Type.Optional(Type.String()),
  offset:Type.Optional(Type.Integer({minimum:0})),
  event_id:Type.Optional(Type.String()),expected_revision:Type.Optional(Type.Integer({minimum:0})),
  summary:Type.Optional(Type.String({maxLength:2000})),topic:Type.Optional(Type.String({maxLength:120})),observed_on:Type.Optional(Type.String()),
  records:Type.Optional(Type.Array(Type.Object({kind:Type.Union([Type.Literal("learning"),Type.Literal("interaction")]),students:Type.Array(Type.String()),summary:Type.String(),topic:Type.Optional(Type.String()),observed_on:Type.Optional(Type.String({description:"已明确的日期 YYYY-MM-DD；不确定时省略"}))}),{minItems:1,maxItems:20})),
});
export function createStudentEventTool(projectRoot:string){
  return defineTool({
    name:"edupi_student_records",label:"学生学习与互动记录",parameters,executionMode:"sequential",
    description:"读取或记录学生学习表现和同伴互动，正式保存到学生档案。所有学生姓名必须与名单一致。一条对话的全部观察一次提交。记录具体事件、方向和时间，不把一次事件推断为永久性格、好友或敌对关系；不确定的人名先澄清。",
    promptGuidelines:["只记录教师明确报告已发生的事情；假设、否定和引用不当作已发生事实。日期不明确就省略。","修订已有记录先 list 取得事件 ID 和 revision，再 update；不要另建一条替代修改。"],
    promptSnippet:"edupi_student_records: 老师叙述学生学习或同伴互动时保存有来源的具体记录；也可检索已有记录",
    execute:async(_call,params,signal,_update,ctx)=>{
      if(resolve(ctx.cwd)!==resolve(projectRoot))throw new Error("请在 EduPi 工作区记录学生情况");
      if(params.action==="list"){
        const result=await studentEventRequest({action:"list_events",student:params.student,offset:params.offset},signal);
        return {content:[{type:"text",text:JSON.stringify(result)}],details:result};
      }
      if(params.action==="update"){
        const result=await studentEventRequest({action:"update_event",event_id:params.event_id,expected_revision:params.expected_revision,summary:params.summary,topic:params.topic,observed_on:params.observed_on},signal);
        return {content:[{type:"text",text:"学生记录已更新，旧内容保留在修改历史中。"}],details:result};
      }
      const message=[...ctx.sessionManager.getBranch()].reverse().find(entry=>entry.type==="message"&&entry.message.role==="user");
      if(!message||message.type!=="message"||message.message.role!=="user")throw new Error("没有可关联的教师消息");
      const content=message.message.content;
      const text=typeof content==="string"?content:content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
      const result=await studentEventRequest({action:"record_events",source:{session_id:ctx.sessionManager.getSessionId(),message_id:message.id,text},records:params.records},signal);
      return {content:[{type:"text",text:result.replayed?"该对话已经处理，未重复新增记录。":`已记录 ${result.record_ids?.length || 0} 条，可在班级的学生记录中查看。`}],details:result};
    },
  });
}
