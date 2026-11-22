import { strict as assert } from "node:assert";

const workspaceId = "5c8c6814-6ea2-488c-85b6-bf3d4914ed6d";
const accountId = "ef4a17e0-f173-48a4-8cb1-a4cc4a27d004";

Deno.test("material upload rejects unsafe IDs before the privileged signer", async (test) => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const environment = {
    SUPABASE_URL: "https://edupi-security-test.invalid",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  };
  const savedEnvironment = new Map(
    Object.keys(environment).map((name) => [name, Deno.env.get(name)]),
  );
  const signedKeys: string[] = [];
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;

  try {
    for (const [name, value] of Object.entries(environment)) Deno.env.set(name, value);
    globalThis.fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, environment.SUPABASE_URL, "unexpected upstream");
      if (url.pathname === "/auth/v1/user") {
        return Promise.resolve(Response.json({ id: accountId, aud: "authenticated" }));
      }
      if (url.pathname === "/rest/v1/workspace_members") {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${workspaceId}`);
        assert.equal(url.searchParams.get("account_id"), `eq.${accountId}`);
        assert.equal(url.searchParams.get("revoked_at"), "is.null");
        return Promise.resolve(Response.json([{ role: "teacher" }]));
      }
      if (url.pathname === "/rest/v1/material_upload_receipts") {
        return Promise.resolve(Response.json([]));
      }
      if (url.pathname.startsWith("/storage/v1/object/edupi-materials/")) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      }
      const prefix = "/storage/v1/object/upload/sign/edupi-materials/";
      if (url.pathname.startsWith(prefix)) {
        const key = decodeURIComponent(url.pathname.slice(prefix.length));
        signedKeys.push(key);
        return Promise.resolve(Response.json({
          url: `/object/upload/sign/edupi-materials/${key}?token=test-upload-token`,
        }));
      }
      throw new Error("unexpected upstream request");
    };
    Deno.serve = ((callback: typeof handler) => {
      handler = callback;
      return {} as Deno.HttpServer;
    }) as typeof Deno.serve;
    await import("./index.ts");
    Deno.serve = originalServe;
    assert.ok(handler, "Edge Function did not install its handler");

    const upload = async (materialId: unknown, fileName = "课前讲义.pdf") => {
      const response = await handler!(new Request("https://edupi.invalid/materials", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-user-token",
          "Content-Type": "application/json",
          "x-edupi-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          action: "create_upload",
          material_id: materialId,
          file_name: fileName,
          content_type: "application/pdf",
          size_bytes: 128,
          sha256: `sha256:${"a".repeat(64)}`,
        }),
      }));
      return { response, body: await response.json() };
    };

    for (const materialId of [
      "../another-workspace",
      "../../another-workspace/material",
      "material/../../another-workspace",
      "material/child",
      "material\\child",
      "..\\another-workspace",
      ".",
      "..",
      "%2e%2e",
      "%2E%2E%2Fanother-workspace",
      "%252e%252e%252fanother-workspace",
      "material%2fchild",
      "material%5cchild",
      "material%255cchild",
      "material?download=1",
      "material#fragment",
      "material\u0000",
      "material\n",
      " material ",
      "a".repeat(161),
      "",
      null,
      12,
    ]) {
      await test.step(`rejects material_id ${JSON.stringify(materialId)}`, async () => {
        const callsBefore = signedKeys.length;
        const { response, body } = await upload(materialId);
        assert.equal(response.status, 400, "unsafe material ID was accepted");
        assert.equal(body.code, "invalid_material_request");
        assert.equal(signedKeys.length, callsBefore, "unsafe path reached service-role signing");
      });
    }

    for (const materialId of ["material-1", "material_42", "hash.2026", "数学讲义-01"]) {
      await test.step(`signs a safe workspace path for ${materialId}`, async () => {
        const callsBefore = signedKeys.length;
        const { response, body } = await upload(materialId);
        assert.equal(response.status, 200);
        assert.equal(signedKeys.length, callsBefore + 1);
        assert.equal(signedKeys.at(-1), body.object_key);
        const segments = body.object_key.split("/");
        assert.equal(segments.length, 3);
        assert.equal(segments[0], workspaceId);
        assert.equal(segments[1], materialId);
        assert.equal(body.path, body.object_key);
        assert.equal(body.external_send, false);
      });
    }

    const binary = new Uint8Array([1, 2, 3]);
    const binaryDigest = await crypto.subtle.digest("SHA-256", binary.slice().buffer);
    const binaryHash = `sha256:${Array.from(new Uint8Array(binaryDigest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const verifiedKey = `${workspaceId}/material-verify/${binaryHash.slice(7)}-课前讲义.pdf`;
    const verifyRequest = (overrides: Record<string, unknown> = {}) => new Request("https://edupi.invalid/materials", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-user-token",
        "Content-Type": "application/json",
        "x-edupi-workspace-id": workspaceId,
      },
      body: JSON.stringify({
        action: "verify_upload", request_id: "verify-material-1", material_id: "material-verify",
        file_name: "课前讲义.pdf", content_type: "application/pdf", size_bytes: 3,
        sha256: binaryHash, object_key: verifiedKey, ...overrides,
      }),
    });
    const verified = await handler!(verifyRequest());
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).verified, true);
    const mismatch = await handler!(verifyRequest({ size_bytes: 4 }));
    assert.equal(mismatch.status, 409);

    await test.step("encoded separators in filenames cannot alter the signed workspace", async () => {
      const { response, body } = await upload("material-1", "%2e%2e%2fother%5cfile.pdf");
      assert.equal(response.status, 200);
      assert.equal(body.object_key.split("/").length, 3);
      assert.equal(body.object_key.split("/")[0], workspaceId);
      assert.equal(body.object_key.includes("%"), false);
    });
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
