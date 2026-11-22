import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.119.2";

export const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-edupi-workspace-id, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

export function handleOptions(request: Request): Response | null {
  return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new ApiError(413, "request_too_large", "请求过大");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_request", "请求必须是 JSON 对象");
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  if (encoded.byteLength > maxBytes) throw new ApiError(413, "request_too_large", "请求过大");
  return body as Record<string, unknown>;
}

function requireUuid(value: string | null, label: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "invalid_workspace", `${label} 无效`);
  }
  return value;
}

export async function requireWorkspace(request: Request): Promise<{
  db: ReturnType<SupabaseClient["schema"]>;
  user: User;
  workspaceId: string;
  role: string;
}> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "unauthorized", "需要登录");
  const workspaceId = requireUuid(request.headers.get("x-edupi-workspace-id"), "workspace_id");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) throw new ApiError(503, "configuration_error", "Supabase 配置不可用");
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new ApiError(401, "unauthorized", "登录状态无效");
  const db = client.schema("edupi");
  const { data: member, error: memberError } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("account_id", userData.user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (memberError) throw new ApiError(503, "membership_unavailable", "工作区成员关系暂不可用");
  if (!member) throw new ApiError(403, "workspace_forbidden", "没有工作区权限");
  return { db, user: userData.user, workspaceId, role: member.role };
}

export async function requireUser(request: Request): Promise<{
  db: ReturnType<SupabaseClient["schema"]>;
  user: User;
}> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "unauthorized", "需要登录");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) throw new ApiError(503, "configuration_error", "Supabase 配置不可用");
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "unauthorized", "登录状态无效");
  return { db: client.schema("edupi"), user: data.user };
}

export async function requireWorkspaceAdmin(request: Request): Promise<{
  db: ReturnType<SupabaseClient["schema"]>;
  adminDb: ReturnType<SupabaseClient["schema"]>;
  adminClient: SupabaseClient;
  user: User;
  workspaceId: string;
  role: string;
}> {
  const context = await requireWorkspace(request);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new ApiError(503, "configuration_error", "Supabase writer 配置不可用");
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return { ...context, adminDb: adminClient.schema("edupi"), adminClient };
}

export function requestId(request: Request, body?: Record<string, unknown>): string {
  const value = request.headers.get("idempotency-key") || body?.request_id;
  if (typeof value === "string" && value.trim().length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(value)) return value.trim();
  return crypto.randomUUID();
}

export function respondError(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: "服务暂不可用", code: "unavailable" }, 503);
}
