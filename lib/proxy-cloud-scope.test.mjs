import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
const routing = await createJiti(import.meta.url).import("./edupi-cloud-chat-routing.ts");
const source = fs.readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class NextResponse extends Response {
  static json(value, init) { return Response.json(value, init); }
  static next() { return new Response("local-next"); }
  static rewrite() { return new Response("cloud-rewrite"); }
}
const modules = {
  "next/server": { NextResponse },
  "@/lib/request-security": { isApiRequestAllowed: () => true, isApiRequestHostAllowed: () => true },
  "@/lib/web-auth": { isWebPasswordEnabled: () => false },
  "@/lib/edupi-cloud-store": { readCloudStateSync: () => ({ mode: "local", generation: 6 }) },
  "@/lib/edupi-cloud-chat-routing": routing,
};
const exports = {};
new Function("require", "exports", code)(name => {
  assert.ok(modules[name], name);
  return modules[name];
}, exports);
const cloud = JSON.stringify(["cloud", "https://synthetic.invalid", "teacher", "workspace", 5]);

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  test(`local chat ${method} refuses an obsolete cloud header`, () => {
    const response = exports.proxy({ method, nextUrl: new URL("http://localhost/api/sessions/same-session"),
      headers: new Headers({ host: "localhost", "x-edupi-cloud-scope": cloud }) });
    assert.equal(response.status, 409);
  });
}
test("a cloud event stream cannot fall back to a local session after logout", () => {
  const response = exports.proxy({ method: "GET",
    nextUrl: new URL(`http://localhost/api/agent/same-session/events?cloudScope=${encodeURIComponent(cloud)}`),
    headers: new Headers({ host: "localhost" }) });
  assert.equal(response.status, 409);
});
test("legacy local reads and exact local snapshot writes keep their normal route", async () => {
  for (const [method, scope] of [["GET", null], ["POST", "local"], ["PATCH", JSON.stringify(["local", 6])]]) {
    const response = exports.proxy({ method, nextUrl: new URL("http://localhost/api/sessions/same-session"),
      headers: new Headers({ host: "localhost", ...(scope ? { "x-edupi-cloud-scope": scope } : {}) }) });
    assert.equal(await response.text(), "local-next");
  }
});
