import type {StudentEvent} from "./edupi-student-events";
export type StudentGraphNode={id:string;kind:"student"|"record"|"topic";label:string;recordIds:string[]};
export function buildStudentGraph(records:readonly StudentEvent[]){
  const selected:StudentEvent[]=[];const students=new Set<string>();
  for(const record of records){
    if(selected.length>=20)break;
    const next=new Set([...students,...(record.student_ids || record.students)]);
    if(next.size>100)continue;
    (record.student_ids || record.students).forEach(id=>students.add(id));selected.push(record);
  }
  const nodes=new Map<string,StudentGraphNode>();
  const edges:Array<{from:string;to:string;recordId:string}>=[];
  const add=(id:string,kind:StudentGraphNode["kind"],label:string,recordId:string)=>{
    const node=nodes.get(id)||{id,kind,label,recordIds:[]};
    if(!node.recordIds.includes(recordId))node.recordIds.push(recordId);nodes.set(id,node);
  };
  for(const record of selected){
    const eventId=`record:${record.id}`;add(eventId,"record",record.summary,record.id);
    for(const [index,name] of record.students.entries()){const id=`student:${record.student_ids?.[index] || name}`;add(id,"student",record.student_labels?.[index] || name,record.id);edges.push({from:id,to:eventId,recordId:record.id});}
    const topic=record.canonical_topic||record.topic;
    if(topic){const id=`topic:${topic}`;add(id,"topic",topic,record.id);edges.push({from:eventId,to:id,recordId:record.id});}
  }
  return {nodes:[...nodes.values()],edges,records:selected};
}
