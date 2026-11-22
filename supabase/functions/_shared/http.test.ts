import { ApiError, requireWorkspace } from "./http.ts";

Deno.test("only active members pass the workspace check", async () => {
  const workspaceId = "5c8c6814-6ea2-488c-85b6-bf3d4914ed6d";
  const accountId = "ef4a17e0-f173-48a4-8cb1-a4cc4a27d004";
  const savedURL = Deno.env.get("SUPABASE_URL");
  const savedKey = Deno.env.get("SUPABASE_ANON_KEY");
  let revoked = false;
  const controller = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen() {},
  }, (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: accountId, aud: "authenticated" });
    }
    if (url.pathname === "/rest/v1/workspace_members") {
      const matching = url.searchParams.get("workspace_id") === `eq.${workspaceId}`
        && url.searchParams.get("account_id") === `eq.${accountId}`
        && (!revoked || url.searchParams.get("revoked_at") !== "is.null");
      return Response.json(matching ? [{ role: "member" }] : []);
    }
    return new Response(null, { status: 404 });
  });

  try {
    Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${server.addr.port}`);
    Deno.env.set("SUPABASE_ANON_KEY", "local-test-key");
    const request = new Request("https://edupi.invalid", {
      headers: {
        Authorization: "Bearer local-test-token",
        "x-edupi-workspace-id": workspaceId,
      },
    });
    const context = await requireWorkspace(request);
    if (context.workspaceId !== workspaceId || context.role !== "member") {
      throw new Error("active member was not recognized");
    }

    revoked = true;
    try {
      await requireWorkspace(request);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.code === "workspace_forbidden") return;
      throw error;
    }
    throw new Error("revoked member was accepted");
  } finally {
    controller.abort();
    await server.finished;
    if (savedURL === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", savedURL);
    if (savedKey === undefined) Deno.env.delete("SUPABASE_ANON_KEY");
    else Deno.env.set("SUPABASE_ANON_KEY", savedKey);
  }
});
