import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { classroomService } from "./edupi-classroom-server";
import type { ClassroomInput, ClassroomRequest } from "./edupi-classroom-types";

const parameters = Type.Object({
  domain: Type.Union([Type.Literal("grades"), Type.Literal("seating"), Type.Literal("duty")]),
  action: Type.Union(["roster", "list", "read", "preview", "save", "restore", "publish"].map(value => Type.Literal(value))),
  id: Type.Optional(Type.String({ maxLength: 120, description: "已有对象 ID；新保存使用 classroom- 加 UUID，重试沿用同一 ID" })),
  expected_revision: Type.Optional(Type.Integer({ minimum: 0, description: "保存、恢复或关联任务时必填；新对象为0" })),
  revision: Type.Optional(Type.Integer({ minimum: 1, description: "恢复的历史版本" })),
  input: Type.Optional(Type.Unknown({ description: "计算输入；先read已有方案查看结构。成绩:{title,class_name,date,subjects:[{name,max_score}],rows:[{row_id,name,student_id,scores}],baseline_id?}；排座:{title,class_name,mode:seating|groups,rows,columns,group_size,student_ids,features,constraints:{gender_strategy,avoid_pairs,fixed_seats},assignments?,exam_id?}；值日:{title,class_name,start_date,days,weekdays,student_ids,exempt_ids,posts:[{id,name,count,weight,gender}],max_per_day,max_days_per_week,assignments?,substitutions?}" })),
}, { additionalProperties: false });

export function createEduPiClassroomTool({ projectRoot, service = classroomService }: { projectRoot: string; service?: typeof classroomService }) {
  return defineTool<typeof parameters, { result: Awaited<ReturnType<typeof classroomService>> }>({
    name: "edupi_classroom",
    label: "班级计算",
    description: "调用 EduPi Core 内置成绩统计及跨考增值、排座分组、值日排班。先用roster取学生稳定ID，preview执行程序计算，解释结果后再按教师要求save；read/list读取同一份正式对象。身份不明必须请教师匹配，禁止猜测。统计、约束、排班全部由此服务计算，不得用模型编造替代。publish仅为已保存值日方案关联正式工作区任务。",
    promptSnippet: "edupi_classroom: 成绩分析、排座分组、值日排班，Core 计算并保存",
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params: Static<typeof parameters>, signal, _onUpdate, ctx) => {
      if (resolve(ctx.cwd) !== resolve(projectRoot)) throw new Error("请在 EduPi 工作区调用班级计算。");
      signal?.throwIfAborted();
      const result = await service({ ...params, action: params.action as ClassroomRequest["action"], input: params.input as ClassroomInput | undefined }, signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } };
    },
  });
}
