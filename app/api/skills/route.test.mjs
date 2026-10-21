import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url);
const pathSecurity = await jiti.import("../../../lib/path-security.ts");
const frontmatter = await jiti.import("../../../lib/skill-frontmatter.ts");
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const serviceCode = compile("../../../lib/skills-service.ts");
const routeCode = compile("./route.ts");
const original = "---\nname: fixture\ndescription: isolated fixture\n---\nKeep this body.\n";

function fixture(t, { safeMode = false, configured = true, coreAlias = false, allowedCoreOnly = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-skill-readonly-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const coreRoot = path.join(root, "sealed-core"), agentDir = path.join(root, "agent");
  const coreSkill = path.join(coreRoot, "skills", "fixture", "SKILL.md");
  const userSkill = path.join(agentDir, "skills", "fixture", "SKILL.md");
  const siblingSkill = path.join(`${coreRoot}-other`, "skills", "fixture", "SKILL.md");
  for (const file of [coreSkill, userSkill, siblingSkill]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, original);
  }
  const aliasRoot = path.join(root, "core-alias");
  fs.symlinkSync(coreRoot, aliasRoot, "junction");
  const directoryAlias = path.join(agentDir, "core-skills");
  fs.symlinkSync(path.join(coreRoot, "skills"), directoryAlias, "junction");
  const fileAlias = path.join(agentDir, "core-skill.md");
  fs.symlinkSync(coreSkill, fileAlias, "file");
  const outwardAlias = path.join(coreRoot, "skills", "outward");
  fs.symlinkSync(path.dirname(userSkill), outwardAlias, "junction");
  const entries = [coreSkill, path.join(directoryAlias, "fixture", "SKILL.md"), fileAlias, userSkill, siblingSkill,
    path.join(outwardAlias, "SKILL.md")].map((filePath, index) => ({ name: `fixture-${index}`, description: "fixture", filePath,
      baseDir: path.dirname(filePath), disableModelInvocation: false, sourceInfo: { source: "path" } }));
  const sdk = { getAgentDir: () => agentDir, DefaultResourceLoader: class {
    async reload() {}
    getSkills() { return { skills: entries, diagnostics: [] }; }
  } };
  const environment = { EDUPI_SAFE_MODE: safeMode ? "1" : "0", ...(configured ? { EDUPI_CORE_ROOT: coreAlias ? aliasRoot : coreRoot } : {}) };
  const serviceDependencies = {
    "@earendil-works/pi-coding-agent": sdk,
    "@/lib/skill-lock": { annotateSkillsWithInstallInfo: skills => skills },
    "@/lib/project-trust": { getProjectTrustStatus: () => ({ trusted: true }), projectTrustReloadOptions: () => undefined },
    "@/lib/edupi-runtime": { builtinEducationSkillPaths: () => [coreSkill], EDUPI_CODE_ROOT: coreRoot, extensionPaths: [] },
    "@/lib/safe-mode": { isSafeModeEnabled: () => safeMode, safeModeResourceOptions: () => ({}) },
    "@/lib/path-security": pathSecurity,
  };
  const service = { exports: {} };
  new Function("require", "module", "exports", "process", serviceCode)(
    name => serviceDependencies[name] ?? require(name), service, service.exports, { env: environment });
  const allowedRoots = new Set([allowedCoreOnly ? coreRoot : root]);
  let beforeAllowedRoots;
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "os": { homedir: () => path.join(root, "home") },
    "@earendil-works/pi-coding-agent": sdk,
    "@/lib/skills-service": service.exports,
    "@/lib/file-access": { getAllowedFileRoots: async () => { beforeAllowedRoots?.(); return allowedRoots; }, isExistingFilePathAllowed: pathSecurity.isExistingPathWithinRoots },
    "@/lib/skill-frontmatter": frontmatter,
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", routeCode)(name => dependencies[name] ?? require(name), route, route.exports);
  return { root, coreRoot, coreSkill, userSkill, siblingSkill, directoryAlias, fileAlias, outwardAlias, aliasRoot,
    service: service.exports,
    beforeAllowedRoots: callback => { beforeAllowedRoots = callback; },
    get: () => route.exports.GET(new Request(`http://localhost/api/skills?cwd=${encodeURIComponent(root)}`)),
    patch: (filePath, disableModelInvocation = true) => route.exports.PATCH(new Request("http://localhost/api/skills", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ filePath, disableModelInvocation }),
    })),
  };
}

test("Core skill PATCH is denied before writing even when Core or its ancestor is allowed", async t => {
  for (const safeMode of [false, true]) for (const allowedCoreOnly of [false, true]) {
    const f = fixture(t, { safeMode, allowedCoreOnly });
    const before = fs.statSync(f.coreSkill, { bigint: true });
    const response = await f.patch(f.coreSkill);
    t.diagnostic(`safeMode=${safeMode}, CoreOnlyAllowlist=${allowedCoreOnly}, HTTP=${response.status}, CoreBytesUnchanged=${fs.readFileSync(f.coreSkill, "utf8") === original}`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Core.*read.only/i);
    assert.equal(fs.readFileSync(f.coreSkill, "utf8"), original);
    assert.equal(fs.statSync(f.coreSkill, { bigint: true }).ctimeNs, before.ctimeNs);
  }
});

test("Core read-only policy covers normalized paths, root aliases, and file or directory symlinks", async t => {
  for (const safeMode of [false, true]) for (const coreAlias of [false, true]) {
    const f = fixture(t, { safeMode, coreAlias });
    const paths = [
      `${path.dirname(f.coreSkill)}${path.sep}..${path.sep}fixture${path.sep}SKILL.md`,
      path.join(f.aliasRoot, "skills", "fixture", "SKILL.md"),
      path.join(f.directoryAlias, "fixture", "SKILL.md"),
      f.fileAlias,
      path.join(f.outwardAlias, "SKILL.md"),
    ];
    const caseAlias = path.join(f.root, "SEALED-CORE", "skills", "fixture", "SKILL.md");
    if (fs.existsSync(caseAlias)) paths.push(caseAlias);
    for (const file of paths) {
      const before = fs.readFileSync(file, "utf8");
      assert.equal((await f.patch(file)).status, 403, "neither a lexical nor real Core path may be edited");
      assert.equal(fs.readFileSync(file, "utf8"), before);
    }
  }
});

test("GET marks only configured Core skills read-only and preserves ordinary skill compatibility", async t => {
  for (const safeMode of [false, true]) for (const coreAlias of [false, true]) {
    const f = fixture(t, { safeMode, coreAlias });
    const response = await f.get();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.skills.map(skill => skill.readOnly), [true, true, true, false, false, true]);
    assert.ok(data.skills.every(skill => skill.disableModelInvocation === false));
    assert.equal(data.projectResourcesLoaded, true);
  }
});

test("PATCH applies the Core policy after the allowed-roots await even if an alias target changes", async t => {
  for (const safeMode of [false, true]) {
    const f = fixture(t, { safeMode });
    fs.unlinkSync(f.fileAlias);
    fs.symlinkSync(f.userSkill, f.fileAlias, "file");
    f.beforeAllowedRoots(() => {
      fs.unlinkSync(f.fileAlias);
      fs.symlinkSync(f.coreSkill, f.fileAlias, "file");
    });
    const response = await f.patch(f.fileAlias);
    assert.equal(response.status, 403);
    assert.equal(fs.readFileSync(f.coreSkill, "utf8"), original);
    assert.equal(fs.readFileSync(f.userSkill, "utf8"), original);
  }
});

test("ordinary and prefix-neighbor skills remain editable in normal and safe mode", async t => {
  for (const safeMode of [false, true]) {
    const f = fixture(t, { safeMode });
    for (const file of [f.userSkill, f.siblingSkill]) {
      assert.equal((await f.patch(file)).status, 200);
      assert.equal(fs.readFileSync(file, "utf8"), frontmatter.setSkillModelInvocationDisabled(original, true));
      assert.equal((await f.patch(file, false)).status, 200);
      assert.equal(fs.readFileSync(file, "utf8"), original);
    }
    assert.equal(fs.readFileSync(f.coreSkill, "utf8"), original);
  }
});

test("an absent explicit Core configuration does not freeze the fallback project skill directory", async t => {
  for (const safeMode of [false, true]) {
    const f = fixture(t, { safeMode, configured: false });
    assert.equal((await f.patch(f.coreSkill)).status, 200);
    const skills = (await (await f.get()).json()).skills;
    assert.ok(skills.every(skill => skill.readOnly === false));
  }
});
