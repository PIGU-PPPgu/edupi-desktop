import { NextResponse } from "next/server";
import { studentEventRequest } from "@/lib/edupi-student-events";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { createEduPiCloudClient } from "@/lib/edupi-cloud-client";
import { captureEducationWriteScope } from "@/lib/edupi-cloud-request-scope";

export const dynamic="force-dynamic";
export async function GET(request:Request) {
  if(!isApiRequestAllowed(request))return NextResponse.json({error:"请求无效"},{status:403});
  const query=new URL(request.url).searchParams;
  const kind=query.get("kind");const offset=Number(query.get("offset")||0);
  if ((kind&&!['learning','interaction'].includes(kind)) || !Number.isSafeInteger(offset) || offset<0) return NextResponse.json({error:"筛选条件无效"},{status:400});
  try {
    const client = createEduPiCloudClient();
    if ((await client.state()).mode === "cloud") {
      const scope = await client.captureScope();
      const params = new URLSearchParams();
      for (const key of ["student_id", "student", "kind", "offset", "query", "from", "to"]) {
        const value = query.get(key);
        if (value !== null) params.set(key, value);
      }
      const student = query.get("student");
      const studentId = query.get("student_id");
      if (student !== null && (!student.trim() || student.length > 240 || /[\u0000-\u001f\u007f]/u.test(student))
        || studentId !== null && (!studentId.trim() || studentId.length > 160 || /[\u0000-\u001f\u007f]/u.test(studentId))) {
        return NextResponse.json({ error: "学生筛选无效", code: "invalid_request" }, { status: 400 });
      }
      if (student && !studentId) {
        // Older deployed functions only understand IDs. Resolve the legacy name
        // through the same scoped broker before forwarding so they cannot widen
        // a student's view to the entire workspace while a server update waits.
        const students = (await client.dashboard(scope)).payload.students;
        const matches = students.filter(row => row.name === student.trim());
        if (matches.length !== 1 || typeof matches[0].student_id !== "string" || !matches[0].student_id) {
          return NextResponse.json({ ok: true, records: [], total: 0, record_ids: [], external_send: false });
        }
        params.set("student_id", matches[0].student_id);
      }
      return NextResponse.json(await client.edge("edupi-student-events", { query: `?${params.toString()}` }, scope));
    }
    return NextResponse.json(await studentEventRequest({action:"list_events",student_id:query.get("student_id")||undefined,student:query.get("student")||undefined,kind:kind||undefined,offset,query:query.get("query")||undefined,from:query.get("from")||undefined,to:query.get("to")||undefined},request.signal));
  }
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"读取失败"},{status:503});}
}
export async function POST(request:Request) {
  if (!isApiRequestAllowed(request)||!hasJsonContentType(request)) return NextResponse.json({error:"请求无效"},{status:403});
  try {
    const body=await parseJsonWithinLimit(request,16_000) as Record<string,unknown>|null;
    const selected = await captureEducationWriteScope(request);
    if (body?.action === "set_topic_alias" && Object.keys(body).every(key => ["action", "alias", "canonical"].includes(key))) {
      if (selected.mode === "cloud") {
        return NextResponse.json({ error: "云端暂不支持主题别名写入。", code: "unsupported_cloud_operation" }, { status: 409 });
      }
      return NextResponse.json(await studentEventRequest(body, request.signal));
    }
    const keys=["action","event_id","expected_revision","summary","topic","observed_on"];
    if (!body || !["update_event","delete_event"].includes(String(body.action)) || Object.keys(body).some(key=>!keys.includes(key))) return NextResponse.json({error:"操作无效"},{status:400});
    if (selected.mode === "cloud") {
      return NextResponse.json(await createEduPiCloudClient().edge("edupi-student-events", { method: "POST", body }, selected.scope));
    }
    return NextResponse.json(await studentEventRequest(body,request.signal));
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:"保存失败"},{status:400});}
}
