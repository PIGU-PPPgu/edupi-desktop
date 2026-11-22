import { cloudChatApi } from "@/lib/edupi-cloud-chat-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ parts: string[] }> };
async function handle(request: Request, context: Context) {
  return cloudChatApi(request, (await context.params).parts);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
