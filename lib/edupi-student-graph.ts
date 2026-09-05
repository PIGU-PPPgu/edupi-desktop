import type {StudentEvent} from "./edupi-student-events";
export type StudentGraphNode={id:string;kind:"student"|"record"|"topic";label:string;recordIds:string[]};
export function buildStudentGraph(records:readonly StudentEvent[]){
  const selected:StudentEvent[]=[];const students=new Set<string>();
  for(const record of records){
    if(selected.length>=8)break;
    const next=new Set([...students,...record.students]);
    if(next.size>24)continue;
    record.students.forEach(name=>students.add(name));selected.push(record);
  }
  const nodes=new Map<string,StudentGraphNode>();
  const edges:Array<{from:string;to:string;recordId:string}>=[];
  const add=(id:string,kind:StudentGraphNode["kind"],label:string,recordId:string)=>{
    const node=nodes.get(id)||{id,kind,label,recordIds:[]};
    if(!node.recordIds.includes(recordId))node.recordIds.push(recordId);nodes.set(id,node);
  };
  for(const record of selected){
    const eventId=`record:${record.id}`;add(eventId,"record",record.summary,record.id);
    for(const name of record.students){const id=`student:${name}`;add(id,"student",name,record.id);edges.push({from:id,to:eventId,recordId:record.id});}
    if(record.topic){const id=`topic:${record.topic}`;add(id,"topic",record.topic,record.id);edges.push({from:eventId,to:id,recordId:record.id});}
  }
  return {nodes:[...nodes.values()],edges,records:selected};
}
