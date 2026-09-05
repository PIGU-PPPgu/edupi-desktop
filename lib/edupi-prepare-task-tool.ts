import {resolve} from "node:path";
import {Type} from "typebox";
import {defineTool} from "@earendil-works/pi-coding-agent";
import {readEducationContract} from "./edupi-education-server";
import {preparationStatus,startPreparation} from "./edupi-preparation-runtime";

const parameters=Type.Object({action:Type.Union([Type.Literal("list"),Type.Literal("prepare"),Type.Literal("status")]),task_id:Type.Optional(Type.String({maxLength:160})),query:Type.Optional(Type.String({maxLength:240}))});
function matchesQuery(task:{title:string;sourceEventName?:string|null;sourceEventDate?:string|null;dueDate?:string|null;deliverables:string[]},query?:string){
  if(!query?.trim())return true;
  const terms=query.trim().split(/\s+/u).map(term=>term.replace(/[^\p{L}\p{N}-]/gu,"")).filter(term=>term.length>1);
  const haystack=[task.title,task.sourceEventName,task.sourceEventDate,task.dueDate,...task.deliverables].filter(Boolean).join(" ").toLocaleLowerCase();
  return terms.every(term=>haystack.includes(term.toLocaleLowerCase()));
}
export function createPrepareTaskTool(projectRoot:string, dependencies:{readEducation?:typeof readEducationContract;start?:typeof startPreparation;status?:typeof preparationStatus}={}){
  const readEducation=dependencies.readEducation||readEducationContract;
  const start=dependencies.start||startPreparation;
  const status=dependencies.status||preparationStatus;
  return defineTool({name:"edupi_prepare_task",label:"执行备课任务",parameters,executionMode:"sequential",
    description:"查询并立即执行已有课表/校历准备任务，生成该任务计划的本地产物草稿。教师明确要求现在准备时，不必等到预定日期。先 list 找到任务，再 prepare 指定 task_id。返回启动状态不代表完成，可用 status 查询；完成后在教学产物中查看。普通手动任务和新增 PPT 等未列入计划的产物不在此工具范围内。",
    promptSnippet:"edupi_prepare_task: 老师要求执行已有备课任务时，实际启动生成；不要只口头承诺",
    execute:async(_id,params,signal,_update,ctx)=>{
      if(resolve(ctx.cwd)!==resolve(projectRoot))throw new Error("请在 EduPi 工作区执行备课");
      signal?.throwIfAborted();
      if(params.action==="status")return {content:[{type:"text",text:JSON.stringify(status())}],details:{}};
      const data=await readEducation();
      const ids=new Set(data.workCases.filter(item=>["teaching_before_class","calendar_preparation"].includes(item.kind)).map(item=>item.taskId));
      const tasks=data.tasks.filter(task=>task.id!==null&&ids.has(task.id));
      if(params.action==="list"){
        const matching=tasks.filter(task=>matchesQuery(task,params.query));
        return {content:[{type:"text",text:JSON.stringify(matching.slice(0,30).map(task=>({task_id:task.id,title:task.title,due_date:task.dueDate,deliverables:task.deliverables})))}],details:{}};
      }
      const task=tasks.find(task=>task.id===params.task_id);
      if(!task)throw new Error("没有找到可执行的课表/校历准备任务，请先查询");
      signal?.throwIfAborted();
      const runStatus=start({taskId:task.id});
      return {content:[{type:"text",text:`已启动「${task.title}」的后台准备。当前状态：${runStatus.state}。生成完成后可在教学产物中查看；现在尚未宣称完成。`}],details:{taskId:task.id,status:runStatus.state}};
    },
  });
}
