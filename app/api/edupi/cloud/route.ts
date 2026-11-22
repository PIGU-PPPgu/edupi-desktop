import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { EduPiCloudError, createEduPiCloudClient } from "@/lib/edupi-cloud-client";
import type { EduPiCloudState } from "@/lib/edupi-cloud-store";
import { hasJsonContentType } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private", Pragma: "no-cache" };
const errors: Record<string, { message: string; status: number }> = {
  cloud_unavailable: { message: "云端操作暂不可用，请重试。", status: 503 },
  network_unavailable: { message: "无法连接云端，待同步记录已保留。", status: 503 },
  configuration_missing: { message: "云端同步尚未配置。", status: 503 },
  configuration_invalid: { message: "云端配置暂不可用。", status: 503 },
  issuer_changed: { message: "云端地址已改变，请先退出原账号。", status: 409 },
  invalid_mode: { message: "数据模式无效。", status: 400 },
  invalid_credentials: { message: "邮箱或密码无效。", status: 400 },
  invalid_request: { message: "云端请求无效。", status: 400 },
  invalid_response: { message: "云端状态未能确认，请重试。", status: 502 },
  unsupported_contract: { message: "云端接口版本与当前客户端不匹配，请更新后重试。", status: 502 },
  invalid_workspace: { message: "工作区无效。", status: 400 },
  login_required: { message: "请重新登录云端账号。", status: 401 },
  unauthorized: { message: "云端登录已过期，请重新登录。", status: 401 },
  workspace_required: { message: "请先选择工作区。", status: 409 },
  workspace_forbidden: { message: "当前账号没有此工作区的权限。", status: 403 },
  workspace_mismatch: { message: "云端工作区不匹配，请重新选择。", status: 409 },
  account_mismatch: { message: "云端账号不匹配，请重新登录。", status: 409 },
  scope_changed: { message: "账号、模式或工作区已改变，请重试。", status: 409 },
  idempotency_conflict: { message: "同步记录发生冲突，请核对后处理。", status: 409 },
  sync_conflict: { message: "云端记录已改变，请核对同步冲突。", status: 409 },
  outbox_full: { message: "待同步记录已满，请先处理已有记录。", status: 409 },
  readback_unverified: { message: "同步结果待确认，记录已保留。", status: 503 },
  rate_limited: { message: "云端请求较多，请稍后重试。", status: 429 },
};

function publicError(error: unknown) {
  let code = "cloud_unavailable";
  if (error instanceof EduPiCloudError) {
    code = Object.hasOwn(errors, error.code) ? error.code
      : error.status === 401 ? "unauthorized"
        : error.status === 403 ? "workspace_forbidden"
          : error.status === 409 ? "sync_conflict"
            : error.status === 429 ? "rate_limited"
              : error.status === 400 ? "invalid_request" : code;
  }
  return { code, message: errors[code].message, status: errors[code].status };
}

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return NextResponse.json({ error: "云端请求过大。", code: "request_limit" }, { status: 413, headers });
  }
  const { code, message, status } = publicError(error);
  return NextResponse.json({ error: message, code }, { status, headers });
}

function publicSession(session: EduPiCloudState["session"]) {
  return {
    state: !session ? "signed_out"
      : Date.parse(session.expiresAt) <= Date.now() ? "expired" : "signed_in",
    user: session ? { id: session.user.id, email: session.user.email } : null,
    expiresAt: session?.expiresAt ?? null,
  };
}

function publicWorkspaces(workspaces: Array<{ id: string; mode: string }>) {
  return workspaces.map(workspace => ({ id: workspace.id, mode: workspace.mode }));
}

function publicState(client: ReturnType<typeof createEduPiCloudClient>, state: EduPiCloudState,
  failure: unknown = null) {
  const expired = failure instanceof EduPiCloudError && failure.status === 401;
  let configured = false;
  try { configured = client.config().configured; }
  catch (error) { failure ??= error; }
  const sync = { pending: 0, conflict: 0, failed: 0 };
  for (const entry of state.outbox) sync[entry.status]++;
  sync.pending += state.completed.filter(item => item.entry.operation === "material-intake"
    && item.result.upload_verified === true && item.result.staging_settled !== true).length;
  const lastError = state.outbox.find(entry => entry.lastError)?.lastError;
  if (!failure && lastError) failure = new EduPiCloudError(lastError, "");
  const safeError = failure ? publicError(failure) : null;
  return {
    mode: state.mode,
    generation: state.generation,
    configured,
    session: { ...publicSession(state.session), ...(expired && state.session ? { state: "expired" } : {}) },
    workspaceId: state.workspaceId,
    pendingSync: sync.pending,
    sync,
    error: safeError ? { code: safeError.code, message: safeError.message } : null,
  };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。", code: "forbidden" }, { status: 403, headers });
  try {
    const client = createEduPiCloudClient();
    let state = await client.state();
    let workspaces: Array<{ id: string; mode: string }> = [];
    let failure: unknown = null;
    // Workspace discovery may refresh or invalidate the session. Its failure
    // must not hide the saved mode or prevent returning to local Core.
    if (publicSession(state.session).state === "signed_in") {
      const generation = state.generation;
      try { workspaces = publicWorkspaces(await client.listWorkspaces()); }
      catch (error) { failure = error; }
      state = await client.state();
      if (state.generation !== generation) workspaces = [];
    }
    return NextResponse.json({
      ...publicState(client, state, failure),
      workspaces,
    }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。", code: "forbidden" }, { status: 403, headers });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON。", code: "invalid_content_type" }, { status: 415, headers });
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action : "";
    const client = createEduPiCloudClient();
    if (action === "set_mode") {
      if (body?.mode !== "local" && body?.mode !== "cloud") {
        return NextResponse.json({ error: "数据模式无效。", code: "invalid_mode" }, { status: 400, headers });
      }
      const state = await client.persistMode(body.mode);
      return NextResponse.json(publicState(client, state), { headers });
    }
    if (action === "login") {
      if (typeof body?.email !== "string" || typeof body?.password !== "string") {
        return NextResponse.json({ error: "请输入邮箱和密码。", code: "invalid_credentials" }, { status: 400, headers });
      }
      const result = await client.login(body.email, body.password);
      return NextResponse.json({
        ...publicState(client, result.state),
        workspaces: publicWorkspaces(result.workspaces),
      }, { headers });
    }
    if (action === "refresh") {
      const state = await client.refresh();
      return NextResponse.json(publicState(client, state), { headers });
    }
    if (action === "logout") {
      const state = await client.logout();
      return NextResponse.json(publicState(client, state), { headers });
    }
    if (action === "list_workspaces") {
      return NextResponse.json({ workspaces: publicWorkspaces(await client.listWorkspaces()) }, { headers });
    }
    if (action === "select_workspace") {
      if (typeof body?.workspace_id !== "string") {
        return NextResponse.json({ error: "工作区无效。", code: "invalid_workspace" }, { status: 400, headers });
      }
      const state = await client.selectWorkspace(body.workspace_id);
      return NextResponse.json(publicState(client, state), { headers });
    }
    if (action === "sync") {
      const result = await client.flushOutbox();
      return NextResponse.json({ ...publicState(client, await client.state()), flushed: result.flushed }, { headers });
    }
    if (action === "dashboard") {
      return NextResponse.json(await client.dashboard(), { headers });
    }
    return NextResponse.json({ error: "不支持的云端操作。", code: "invalid_action" }, { status: 400, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
