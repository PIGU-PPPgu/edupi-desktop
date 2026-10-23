import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Linter } from "eslint";
import semver from "semver";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = nextRequire("./utils/get-root-dirs.js");

test("KaTeX is pinned to the patched release for every installed math consumer", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.devDependencies.katex, "0.18.2");
  assert.equal(manifest.overrides.katex, "$katex");
  const entries = Object.entries(lock.packages).filter(([location]) => /(?:^|\/)node_modules\/katex$/.test(location));
  assert.ok(entries.length > 0);
  for (const [location, entry] of entries) assert.equal(entry.version, "0.18.2", location);
  for (const consumer of [null, "mermaid", "rehype-katex", "micromark-extension-math", "@lobehub/ui"]) {
    const consumerRequire = consumer ? createRequire(require.resolve(consumer)) : require;
    const entry = consumerRequire.resolve("katex");
    const installed = JSON.parse(await readFile(path.resolve(path.dirname(entry), "..", "package.json"), "utf8"));
    assert.equal(installed.version, "0.18.2", consumer || "direct dependency");
    assert.equal(installed.license, "MIT");
    assert.equal(entry, require.resolve("katex"), consumer || "direct dependency");
  }
});

test("KaTeX ignores inherited trust without changing explicitly owned trust in an isolated child", t => {
  assert.equal(Object.hasOwn(Object.prototype, "trust"), false);
  try {
    const output = execFileSync(process.execPath, ["-e", String.raw`
      const assert = require("node:assert/strict");
      const katex = require(process.argv[1]);
      const expression = process.argv[2];
      let inherited, denied, owned;
      Object.defineProperty(Object.prototype, "trust", { value: true, writable: true, configurable: true });
      try {
        inherited = katex.renderToString(expression, { strict: false, throwOnError: false });
        denied = katex.renderToString(expression, { strict: false, throwOnError: false, trust: false });
        owned = katex.renderToString(process.argv[3], { trust: true });
      } finally { delete Object.prototype.trust; }
      assert.doesNotMatch(inherited, /<a\b[^>]*href=/, "inherited trust must not enable a link");
      assert.doesNotMatch(denied, /<a\b[^>]*href=/);
      assert.match(owned, /<a\b[^>]*href="https:\/\/synthetic\.example\.invalid\/"/);
      console.log("KaTeX " + katex.version + ": inherited trust blocked; explicit false blocked; explicit true preserved");
    `, require.resolve("katex"), String.raw`\href{javascript:alert(1)}{synthetic}`,
    String.raw`\href{https://synthetic.example.invalid/}{synthetic}`], { timeout: 2000, killSignal: "SIGKILL", stdio: "pipe", encoding: "utf8" });
    t.diagnostic(output.trim());
  } finally { assert.equal(Object.hasOwn(Object.prototype, "trust"), false); }
});

test("Mermaid's resolved KaTeX API renders fractions, roots and matrices in both output modes", async () => {
  const mermaidRequire = createRequire(require.resolve("mermaid"));
  const katex = mermaidRequire("katex");
  const { DOMParser } = require("@xmldom/xmldom");
  for (const [expression, expectedTag] of [[String.raw`\frac{1}{2}`, "mfrac"], [String.raw`\sqrt{x}`, "msqrt"],
    [String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, "mtable"]]) {
    for (const output of ["mathml", "htmlAndMathml"]) {
      const html = katex.renderToString(expression, { throwOnError: true, displayMode: true, output });
      const document = new DOMParser().parseFromString(html, "application/xml");
      assert.equal(document.getElementsByTagNameNS("http://www.w3.org/1998/Math/MathML", "math").length, 1);
      assert.equal(document.getElementsByTagNameNS("http://www.w3.org/1998/Math/MathML", expectedTag).length, 1);
      assert.equal(document.getElementsByTagNameNS("http://www.w3.org/1998/Math/MathML", "math")[0].getAttribute("display"), "block");
      if (output === "htmlAndMathml") assert.match(html, /class="katex-display"/);
      assert.doesNotMatch(html, /katex-error/);
    }
  }
  const css = require.resolve("katex/dist/katex.min.css");
  const stylesheet = await readFile(css, "utf8");
  assert.match(stylesheet, /\.katex-display/);
  assert.match(stylesheet, /\.katex\b/);
  const fonts = [...stylesheet.matchAll(/url\(["']?([^)"']+\.woff2)["']?\)/g)].map(match => match[1]);
  assert.ok(fonts.length > 0);
  for (const font of fonts) assert.ok((await readFile(path.resolve(path.dirname(css), font))).byteLength > 0, font);
});

test("the complete lockfile excludes affected runtime and glob dependency versions", async () => {
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const patched = { next: ">=16.4.1", undici: ">=8.10.2", nodemailer: ">=10.0.9", "brace-expansion": "^1.1.21 || ^3.0.9 || >=5.0.12", dompurify: ">=3.4.17", sharp: ">=0.35.5", hono: ">=4.13.11", "ip-address": ">=10.7.4", "@modelcontextprotocol/client": ">=2.3.0", "@modelcontextprotocol/server": ">=2.3.0" };
  for (const [location, entry] of Object.entries(lock.packages)) {
    const name = location.split("node_modules/").at(-1);
    assert.notEqual(name, "braces", `${location} restores the unpatched dependency`);
    if (patched[name]) assert.ok(semver.satisfies(entry.version, patched[name]), `${location}: ${entry.version}`);
  }
});

test("the Cargo lock excludes disclosed certificate and Unix I/O safety versions", async () => {
  const lock = await readFile(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const patched = {
    "rustls-webpki": ">=0.103.16 <0.104.0-alpha.1 || >=0.104.0-alpha.8",
    "webpki-root-certs": ">=1.0.10",
    // RUSTSEC-2026-0386; exclude the separately affected 1.54.0 from 0384.
    tokio: ">=1.51.6 <1.52.0 || >=1.53.3 <1.54.0 || >=1.54.1",
  };
  const packages = lock.split("[[package]]").slice(1).map(entry => ({
    name: entry.match(/^name = "([^"]+)"$/mu)?.[1],
    version: entry.match(/^version = "([^"]+)"$/mu)?.[1],
  }));
  for (const [name, range] of Object.entries(patched)) {
    const entries = packages.filter(entry => entry.name === name);
    assert.ok(entries.length > 0, name + " is missing from the reviewed lock");
    for (const entry of entries) assert.ok(semver.satisfies(entry.version, range), name + ": " + entry.version);
  }
});

test("patched sharp renders a bounded SVG through its prebuilt image library", async () => {
  const sharp = require("sharp");
  assert.ok(semver.gte(sharp.versions.sharp, "0.35.5"));
  assert.ok(semver.gte(sharp.versions.rsvg, "2.63.2"));
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ff0000"/></svg>')).png().toBuffer();
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [2, 2, 4]);
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255]);
});

test("OpenConnector uses the patched MCP client and completes an in-memory tool call", async () => {
  const entry = import.meta.resolve("@oomol-lab/open-connector");
  const connectorRequire = createRequire(entry);
  const clientEntry = connectorRequire.resolve("@modelcontextprotocol/client");
  const installed = JSON.parse(await readFile(path.resolve(path.dirname(clientEntry), "..", "package.json"), "utf8"));
  assert.equal(installed.version, "2.3.0");
  const { withMcpClient } = await import(new URL("../providers/mcp-client.js", entry));
  const methods = [];
  const endpoint = "https://synthetic-mcp.example.invalid/mcp";
  const fetcher = async (input, init) => {
    assert.equal(String(input), endpoint);
    if (init.method === "GET") return new Response(null, { status: 405 });
    const message = JSON.parse(init.body);
    methods.push(message.method);
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result = message.method === "server/discover"
      ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } }
      : { resultType: "complete", content: [{ type: "text", text: "synthetic result" }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { headers: { "content-type": "application/json" } });
  };
  const result = await withMcpClient({ endpoint, transport: "streamable_http", protocolVersion: "modern", fetcher, headers: {}, redirect: "manual" }, client => client.callTool({ name: "synthetic_read", arguments: {} }));
  assert.equal(result.content[0].text, "synthetic result");
  assert.ok(methods.includes("server/discover"));
  assert.ok(methods.includes("tools/call"));
});

test("connector Hono static serving cannot bypass a protected prefix by double decoding", async () => {
  const connectorRequire = createRequire(import.meta.resolve("@oomol-lab/open-connector"));
  const { Hono } = await import(pathToFileURL(connectorRequire.resolve("hono")).href);
  const { serveStatic } = await import(pathToFileURL(connectorRequire.resolve("hono/serve-static")).href);
  const app = new Hono(), reads = [];
  app.use("/private/*", context => context.text("denied", 403));
  app.use("*", serveStatic({ root: "assets", getContent(filename) {
    reads.push(filename);
    if (filename.endsWith("/private/secret.txt")) return new TextEncoder().encode("SYNTHETIC_PROTECTED_STATIC_BODY");
    if (filename.endsWith("/public.txt")) return new TextEncoder().encode("SYNTHETIC_PUBLIC_STATIC_BODY");
    return null;
  } }));
  const publicResponse = await app.request("http://localhost/public.txt");
  assert.equal(publicResponse.status, 200); assert.equal(await publicResponse.text(), "SYNTHETIC_PUBLIC_STATIC_BODY");
  assert.equal((await app.request("http://localhost/private/secret.txt")).status, 403);
  const encoded = await app.request("http://localhost/%2570rivate/secret.txt");
  assert.equal(encoded.status, 404); assert.equal((await encoded.text()).includes("SYNTHETIC_PROTECTED_STATIC_BODY"), false);
  assert.equal(reads.some(filename => filename.endsWith("/private/secret.txt")), false);
});

test("the connector's SOCKS address parser rejects a pathological IPv6 zone in a bounded child", () => {
  const connectorRequire = createRequire(import.meta.resolve("@oomol-lab/open-connector"));
  const imapRequire = createRequire(connectorRequire.resolve("imapflow"));
  const socksRequire = createRequire(imapRequire.resolve("socks"));
  execFileSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const { Address4, Address6 } = require(process.argv[1]);
    assert.equal(Address4.isValid("127.0.0.1"), true);
    assert.equal(Address6.isValid("::1"), true);
    assert.equal(Address6.isValid("fe80::1%en0"), true);
    assert.equal(Address6.isValid("%".repeat(1_000_000) + "\\n"), false);
  `, socksRequire.resolve("ip-address")], { timeout: 2000, killSignal: "SIGKILL", stdio: "pipe" });
});

test("Next root matching preserves static, absolute, brace and stepped patterns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-next-root-"));
  try {
    for (const directory of ["app", "app/nested", "app-01", "app-02", "app-03", "app-10", "app-11", "app-12", ".hidden"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    const resolve = pattern => getRootDirs({ cwd: root, settings: { next: { rootDir: pattern } } }).sort();
    assert.deepEqual(getRootDirs({ cwd: root, settings: {} }), [root]);
    assert.deepEqual(resolve(`${root}/app`), [`${root}/app`]);
    assert.deepEqual(resolve(`${root}/app/`), [`${root}/app`]);
    assert.deepEqual(resolve(`${root}/app-{01..03}`), ["01", "02", "03"].map(n => `${root}/app-${n}`));
    assert.deepEqual(resolve(`${root}/app-{10..12}`), ["10", "11", "12"].map(n => `${root}/app-${n}`));
    assert.deepEqual(resolve(`${root}/app-{10..12..2}`), ["10", "12"].map(n => `${root}/app-${n}`));
    assert.deepEqual(resolve(`${root}/{app,.hidden}`), [`${root}/.hidden`, `${root}/app`]);
    assert.deepEqual(resolve([`${root}/app`, `${root}/missing`]), [`${root}/app`]);
    assert.deepEqual(resolve(`${root}/app`.replaceAll("/", "\\")), [`${root}/app`]);
    assert.deepEqual(resolve("vendor/next-root-glob"), ["vendor/next-root-glob"]);
    assert.throws(() => nextRequire("fast-glob").globSync("app", { onlyFiles: true }), /Unsupported Next/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi 1.0.2 is pinned consistently and resolves secure packages without installation patches", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const name of ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui"]) {
    const packageName = `@earendil-works/${name}`;
    const installed = JSON.parse(await readFile(new URL(`../node_modules/${packageName}/package.json`, import.meta.url), "utf8"));
    assert.equal(manifest.dependencies[packageName], "1.0.2");
    assert.equal(lock.packages[`node_modules/${packageName}`].version, "1.0.2");
    assert.equal(installed.version, "1.0.2");
  }
  const sdkRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
  assert.ok(semver.gte(sdkRequire("undici/package.json").version, "8.10.2"));
  assert.ok(semver.gte(sdkRequire("brace-expansion/package.json").version, "5.0.12"));
  assert.ok(semver.gte(sdkRequire("minimatch/package.json").version, "10.2.6"));
  const sdk = await import("@earendil-works/pi-coding-agent");
  assert.equal(typeof sdk.createAgentSessionRuntime, "function");
  assert.equal(typeof sdk.createAgentSessionFromServices, "function");
});

test("the actual Next internal-link lint rule still rejects a plain anchor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-next-lint-"));
  try {
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages", "about.js"), "export default function About() { return null; }");
    const linter = new Linter();
    const config = {
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      settings: { next: { rootDir: root } },
      plugins: { "@next/next": nextRequire("./index.js") },
      rules: { "@next/next/no-html-link-for-pages": "error" },
    };
    const results = linter.verify('const page = <a href="/about">About</a>;', config);
    assert.equal(results.length, 1);
    assert.equal(results[0].ruleId, "@next/next/no-html-link-for-pages");
    assert.deepEqual(linter.verify('const page = <a href="https://example.com">About</a>;', config), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("OpenConnector resolves patched Nodemailer and still composes readable mail without sending", async () => {
  const connectorRequire = createRequire(import.meta.resolve("@oomol-lab/open-connector"));
  const mailer = connectorRequire("nodemailer");
  const { simpleParser } = connectorRequire("mailparser");
  assert.ok(semver.gte(connectorRequire("nodemailer/package.json").version, "10.0.9"));
  const transport = mailer.createTransport({ streamTransport: true, buffer: true });
  try {
    const result = await transport.sendMail({ from: "teacher@example.invalid", to: "test@example.invalid",
      subject: "隔离依赖兼容测试", text: "Only in-memory MIME, no SMTP connection.", disableFileAccess: true, disableUrlAccess: true });
    const parsed = await simpleParser(result.message);
    assert.equal(parsed.subject, "隔离依赖兼容测试");
    assert.equal(parsed.to.value[0].address, "test@example.invalid");
    assert.match(parsed.text, /Only in-memory MIME/);
  } finally { transport.close(); }
});
