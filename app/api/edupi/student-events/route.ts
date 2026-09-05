import { NextResponse } from "next/server";
import { studentEventRequest } from "@/lib/edupi-student-events";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";

export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const query=new URL(request.url).searchParams;
  const kind=query.get("kind");const offset=Number(query.get("offset")||0);
  if ((kind&&!['learning','interaction'].includes(kind)) || !Number.isSafeInteger(offset) || offset<0) return NextResponse.json({error:"筛选条件无效"},{status:400});
  try {return NextResponse.json(await studentEventRequest({action:"list_events",student:query.get("student")||undefined,kind:kind||undefined,offset}));}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"读取失败"},{status:503});}
}
export async function POST(request:Request) {
  if (!isApiRequestAllowed(request)||!hasJsonContentType(request)) return NextResponse.json({error:"请求无效"},{status:403});
  try {
    const body=await parseJsonWithinLimit(request,16_000) as Record<string,unknown>|null;
    const keys=["action","event_id","expected_revision","summary","topic","observed_on"];
    if (!body || !["update_event","delete_event"].includes(String(body.action)) || Object.keys(body).some(key=>!keys.includes(key))) return NextResponse.json({error:"操作无效"},{status:400});
    return NextResponse.json(await studentEventRequest(body));
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:"保存失败"},{status:400});}
}
