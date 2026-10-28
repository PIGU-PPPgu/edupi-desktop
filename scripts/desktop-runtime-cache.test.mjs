import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { default: FileSystemCache } = require("next/dist/server/lib/incremental-cache/file-system-cache");
const { defaultConfig } = require("next/dist/server/config-shared");
const { getRouteCacheKey } = require("next/dist/server/lib/route-cache-key");
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(projectRoot, "next.config.ts");
const configCode = ts.transpileModule(readFileSync(configPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function projectConfig(desktop) {
  const configModule = { exports: {} };
  vm.runInNewContext(configCode, {
    module: configModule, exports: configModule.exports, require, __dirname: projectRoot,
    process: { env: desktop ? { PI_WEB_DESKTOP_BUILD: "1" } : {} },
  }, { filename: configPath });
  const config = configModule.exports.default;
  return { ...defaultConfig, ...config, experimental: { ...defaultConfig.experimental, ...config.experimental } };
}

function clearNextCacheMemory() {
  // Next also retains this LRU in memory-cache.external. Empty that shared
  // instance before dropping the class reference so every fixture is cold.
  for (const [key] of [...(FileSystemCache.memoryCache ?? [])]) FileSystemCache.memoryCache.remove(key);
  FileSystemCache.memoryCache = undefined;
  FileSystemCache.seedReads.clear();
}

function memoryFilesystem(root) {
  const files = new Map(), reads = [], writes = [], directories = [];
  const get = file => {
    const entry = files.get(normalize(file));
    if (!entry) throw Object.assign(new Error(`Synthetic cache entry missing: ${relative(root, file)}`), { code: "ENOENT" });
    return entry;
  };
  const read = (file, encoding) => {
    reads.push(normalize(file));
    const data = Buffer.from(get(file).data);
    return encoding ? data.toString(encoding) : data;
  };
  const put = (file, data) => files.set(normalize(file), {
    data: Buffer.from(data), mtime: new Date("2035-01-01T00:00:00.000Z"),
  });
  const write = (method, file, data) => {
    writes.push({ method, path: relative(root, file).split("\\").join("/") });
    put(file, data);
  };
  return {
    files, reads, writes, directories, put,
    snapshot: () => [...files].map(([file, entry]) => [relative(root, file), entry.data.toString("base64")]).sort(),
    fs: {
      existsSync: file => files.has(normalize(file)),
      readFileSync: read,
      async readFile(file, encoding) { return read(file, encoding); },
      async stat(file) { return { mtime: get(file).mtime }; },
      async mkdir(directory) { directories.push(normalize(directory)); },
      async writeFile(file, data) { write("writeFile", file, data); },
      async writeFileAtomic(file, data) { write("writeFileAtomic", file, data); },
    },
  };
}

function cacheFixture(t, desktop, kind = "APP_ROUTE") {
  clearNextCacheMemory();
  t.after(clearNextCacheMemory);
  const config = projectConfig(desktop);
  // This path is only a namespace for the Map: no directory or fixture is
  // created on disk, and no filesystem method below reaches node:fs writes.
  const serverDistDir = join(tmpdir(), "edupi-synthetic-runtime-cache", "server");
  const storage = memoryFilesystem(serverDistDir);
  const pathname = kind === "APP_ROUTE" ? "/synthetic.webmanifest" : "/synthetic-page";
  const owner = { kind, sourceRoute: `${pathname}/${kind === "APP_ROUTE" ? "route" : "page"}` };
  const key = getRouteCacheKey(pathname, owner);
  const seed = join(serverDistDir, "app", pathname.slice(1));
  const payload = kind === "APP_ROUTE" ? Buffer.from('{"name":"synthetic manifest"}') : "<main>synthetic page</main>";
  const meta = {
    status: 200, headers: {}, cacheControl: { revalidate: false },
    routeCache: { key, owner, isFallback: false },
    ...(kind === "APP_PAGE" ? { segmentPaths: ["/_tree", "/_full", "/synthetic/__PAGE__"] } : {}),
  };
  storage.put(`${seed}.${kind === "APP_ROUTE" ? "body" : "html"}`, payload);
  storage.put(`${seed}.meta`, JSON.stringify(meta));
  if (kind === "APP_PAGE") {
    storage.put(`${seed}.rsc`, "synthetic rsc data");
    for (const segment of meta.segmentPaths) storage.put(`${seed}.segments${segment}.segment.rsc`, `synthetic segment ${segment}`);
  }
  const cache = new FileSystemCache({
    fs: storage.fs, serverDistDir, revalidatedTags: [],
    flushToDisk: config.experimental.isrFlushToDisk,
    maxMemoryCacheSize: config.cacheMaxMemorySize,
  });
  assert.ok(!FileSystemCache.memoryCache?.has(key), "a cold-cache fixture cannot borrow a prior memory entry");
  return { config, storage, cache, key, seed, meta, payload, context: { kind, isFallback: false } };
}

function assertSeedPayload(result, fixture) {
  assert.ok(result, "the verified immutable seed must remain readable");
  assert.equal(result.value.kind, fixture.context.kind);
  if (fixture.context.kind === "APP_ROUTE") {
    assert.deepEqual(result.value.body, fixture.payload);
  } else {
    assert.equal(result.value.html, fixture.payload);
    assert.equal(result.value.rscData.toString(), "synthetic rsc data");
    for (const segment of fixture.meta.segmentPaths) assert.equal(result.value.segmentData.get(segment).toString(), `synthetic segment ${segment}`);
  }
  assert.equal(result.cacheControl.revalidate, false);
}

test("the real project config disables disk flushing only for desktop standalone builds", () => {
  const desktop = projectConfig(true), web = projectConfig(false);
  assert.equal(desktop.output, "standalone");
  assert.equal(desktop.distDir, ".next-desktop");
  assert.equal(desktop.experimental.isrFlushToDisk, false);
  assert.equal(web.experimental.isrFlushToDisk, defaultConfig.experimental.isrFlushToDisk);
  assert.equal(web.experimental.isrFlushToDisk, true, "the normal web build is the positive disk-write control");
});

for (const kind of ["APP_ROUTE", "APP_PAGE"]) {
  test(`desktop cold ${kind} reads the seed and RSC closure without disk writes`, async t => {
    const fixture = cacheFixture(t, true, kind);
    const before = fixture.storage.snapshot();
    const result = await fixture.cache.get(fixture.key, fixture.context);
    assertSeedPayload(result, fixture);
    assert.ok(fixture.storage.reads.includes(normalize(`${fixture.seed}.meta`)));
    assert.deepEqual(fixture.storage.writes, []);
    assert.deepEqual(fixture.storage.directories, []);
    assert.deepEqual(fixture.storage.snapshot(), before, "serving the route must not add or modify sealed resources");
  });

  test(`normal web cold ${kind} promotes its complete scoped cache as a positive control`, async t => {
    const fixture = cacheFixture(t, false, kind);
    const result = await fixture.cache.get(fixture.key, fixture.context);
    assertSeedPayload(result, fixture);
    const scoped = fixture.key.slice(1);
    const expected = kind === "APP_ROUTE" ? [`${scoped}.meta`, `${scoped}.body`]
      : [`${scoped}.rsc`, ...fixture.meta.segmentPaths.map(segment => `${scoped}.segments${segment}.segment.rsc`), `${scoped}.meta`, `${scoped}.html`];
    assert.deepEqual(fixture.storage.writes.map(write => write.path).sort(), expected.sort());
    assert.equal(fixture.storage.writes.at(-1).method, "writeFileAtomic", "the primary payload is published after its sidecars");
  });
}

for (const desktop of [true, false]) {
  test(`${desktop ? "desktop" : "normal web"} ordinary APP_ROUTE.set ${desktop ? "keeps memory only" : "writes body and metadata"}`, async t => {
    const fixture = cacheFixture(t, desktop);
    const before = fixture.storage.snapshot();
    const value = { kind: "APP_ROUTE", body: Buffer.from("synthetic updated response"), headers: {}, status: 200 };
    await fixture.cache.set(fixture.key, value, { ...fixture.context, fetchCache: false, cacheControl: { revalidate: false } });
    assert.deepEqual((await fixture.cache.get(fixture.key, fixture.context)).value.body, value.body, "in-process caching must still work");
    if (desktop) {
      assert.deepEqual(fixture.storage.writes, []);
      assert.deepEqual(fixture.storage.directories, []);
      assert.deepEqual(fixture.storage.snapshot(), before);
    } else {
      assert.deepEqual(fixture.storage.writes.map(write => write.path).sort(), [`${fixture.key.slice(1)}.body`, `${fixture.key.slice(1)}.meta`].sort());
    }
  });
}

test("desktop seed reads still reject a foreign owner, key or fallback envelope", async t => {
  for (const change of ["owner", "key", "fallback"]) {
    const fixture = cacheFixture(t, true);
    const routeCache = { ...fixture.meta.routeCache };
    if (change === "owner") routeCache.owner = { ...routeCache.owner, sourceRoute: "/foreign/route" };
    if (change === "key") routeCache.key = getRouteCacheKey("/foreign", routeCache.owner);
    if (change === "fallback") routeCache.isFallback = true;
    fixture.storage.put(`${fixture.seed}.meta`, JSON.stringify({ ...fixture.meta, routeCache }));
    assert.equal(await fixture.cache.get(fixture.key, fixture.context), null, change);
    assert.deepEqual(fixture.storage.writes, []);
  }
});
