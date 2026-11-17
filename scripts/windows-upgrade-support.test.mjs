import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  OLD, TAURI_DRIVER, assertDriverVersion, assertOldAsset, downloadOldInstaller,
  readInputs, safeCode, saveVerifiedDownload, validateCohortUrl, validateHash, validateId,
} from "./windows-upgrade-support.mjs";

function release(overrides = {}) {
  return {
    id: Number(OLD.releaseId), tag_name: `v${OLD.version}`, target_commitish: OLD.sourceSha, draft: true,
    assets: [{
      id: Number(OLD.assetId), name: OLD.name, size: 10, digest: `sha256:${OLD.sha256}`, state: "uploaded",
      url: `https://api.github.com/repos/${OLD.repository}/releases/assets/${OLD.assetId}`,
      browser_download_url: `https://github.com/${OLD.repository}/releases/download/v${OLD.version}/${OLD.name}`,
    }], ...overrides,
  };
}
const cohort = `https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/${"a".repeat(40)}/docs/acceptance/update-cohorts/windows-116-117.json`;
const upgradeEnvironment = () => ({
  WINDOWS_UPGRADE_MODE: "upgrade", WINDOWS_UPGRADE_TARGET_RELEASE_ID: "447680099",
  WINDOWS_UPGRADE_TARGET_ASSET_ID: "1234", WINDOWS_UPGRADE_TARGET_SOURCE_SHA: "b".repeat(40),
  WINDOWS_UPGRADE_TARGET_ASSET_SHA256: "c".repeat(64), WINDOWS_UPGRADE_COHORT_URL: cohort,
});

test("IDs, hashes and immutable URLs reject shell text, alternate origins, credentials and normalization", () => {
  assert.equal(validateId(OLD.assetId), OLD.assetId);
  for (const value of ["0", "-1", "01", "1\n", "1;exit", "$(touch pwned)", "9223372036854775808", 1, undefined]) {
    assert.throws(() => validateId(value));
  }
  assert.equal(validateHash(OLD.sourceSha, 40), OLD.sourceSha);
  for (const value of [OLD.sha256.toUpperCase(), ` ${OLD.sha256}`, `${OLD.sha256}\n`, "a".repeat(63)]) {
    assert.throws(() => validateHash(value));
  }
  assert.equal(validateCohortUrl(cohort), cohort);
  for (const invalid of [
    cohort.replace("https:", "http:"), cohort.replace("raw.githubusercontent.com", "github.com"),
    cohort.replace("/PIGU-PPPgu/", "/someone/"), cohort.replace("/edupi-desktop/", "/edupi/"),
    cohort.replace("a".repeat(40), "main"), cohort.replace("/docs/", "/other/../docs/"),
    cohort.replace("https://", "https://user:pass@"), cohort.replace(".com/", ".com:443/"),
    cohort.replace("/windows-", "/Windows-"), `${cohort}?token=secret`, `${cohort}#x`,
    cohort.replace(".json", "%2ejson"), `${cohort}\n`,
  ]) assert.throws(() => validateCohortUrl(invalid), invalid);
});

test("preflight needs no target, upgrade requires all validated inputs but makes no execution claim", () => {
  assert.deepEqual(readInputs({}), { mode: "preflight", target: null });
  const target = readInputs(upgradeEnvironment()).target;
  assert.equal(target.version, "0.3.117");
  assert.equal(target.cohortUrl, cohort);
  for (const key of Object.keys(upgradeEnvironment())) {
    if (key === "WINDOWS_UPGRADE_MODE") continue;
    assert.throws(() => readInputs({ ...upgradeEnvironment(), [key]: "" }));
  }
  assert.throws(() => readInputs({ WINDOWS_UPGRADE_MODE: "publicize" }));
  assert.throws(() => readInputs({ ...upgradeEnvironment(), WINDOWS_UPGRADE_MODE: "preflight" }));
});

test("frozen Draft lookup requires exact tag, commit, asset ID, size and digest even when metadata changed", () => {
  assert.equal(assertOldAsset(release()).draft, true);
  assert.equal(assertOldAsset(release({ draft: false })).draft, false);
  for (const item of [
    release({ tag_name: "untagged-df41d75c4b0cbd7734b1" }), release({ target_commitish: "main" }),
    release({ id: 123 }), release({ assets: [] }), release({ assets: [...release().assets, ...release().assets] }),
    ...["id", "name", "size", "digest", "url", "browser_download_url", "state"].map(key => {
      const r = release(); r.assets[0][key] = key === "size" ? -1 : "unexpected"; return r;
    }),
  ]) assert.throws(() => assertOldAsset(item));
});

test("only a Draft may retain GitHub's original untagged asset URL after its tag metadata is repaired", () => {
  const original = `https://github.com/${OLD.repository}/releases/download/untagged-6596d5e2f5fe6f8d1177/${OLD.name}`;
  const draft = release();
  draft.assets[0].browser_download_url = original;
  assert.equal(assertOldAsset(draft).id, OLD.assetId);
  assert.throws(() => assertOldAsset({ ...draft, draft: false }));
  for (const invalid of [
    original.replace("PIGU-PPPgu", "another"), original.replace(OLD.name, "other.exe"),
    original.replace("6596d5e2f5fe6f8d1177", "main"),
    original.replace("6596d5e2f5fe6f8d1177", "6596D5E2F5FE6F8D1177"),
    original.replace("untagged-", "v"), `${original}?token=x`, `${original}\n`,
  ]) {
    const item = release(); item.assets[0].browser_download_url = invalid;
    assert.throws(() => assertOldAsset(item));
  }
});

test("driver matching compares all three runtime build components, never just browser major", () => {
  assert.equal(TAURI_DRIVER.version, "2.0.4");
  assert.equal(TAURI_DRIVER.crateSha256.length, 64);
  assert.doesNotThrow(() => assertDriverVersion("131.0.2903.48", "131.0.2903.86"));
  for (const driver of ["131.0.2904.48", "131.1.2903.48", "132.0.2903.48", "131.0.2903", "131.0.2903.48\n"]) {
    assert.throws(() => assertDriverVersion("131.0.2903.48", driver));
  }
});

test("streamed download verifies full size/hash and removes partial bytes on interruption or mismatch", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-stream-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const bytes = Buffer.from("synthetic installer stream, never executed");
  const expected = { size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  const destination = path.join(directory, "synthetic.exe");
  await saveVerifiedDownload(new Response(bytes), destination, expected);
  assert.deepEqual(fs.readFileSync(destination), bytes);
  await assert.rejects(saveVerifiedDownload(new Response(bytes), destination, expected), /exclusive/);
  for (const [name, response, metadata] of [
    ["short", new Response(bytes.subarray(1)), expected],
    ["long", new Response(Buffer.concat([bytes, bytes])), expected],
    ["hash", new Response(bytes), { ...expected, sha256: "0".repeat(64) }],
    ["interrupted", new Response(new ReadableStream({ pull(controller) {
      controller.error(new Error("synthetic interruption"));
    } })), expected],
  ]) {
    const file = path.join(directory, `${name}.exe`);
    await assert.rejects(saveVerifiedDownload(response, file, metadata));
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.partial`), false);
  }
});

test("API asset download never forwards GitHub authorization to the CDN or prints a signed URL", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-auth-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const calls = [], token = "synthetic-github-token";
  await assert.rejects(downloadOldInstaller({
    directory, token, async fetcher(url, init) {
      calls.push({ url, init });
      if (calls.length === 1) return Response.json(release());
      if (calls.length === 2) return new Response(null, { status: 302,
        headers: { location: "https://release-assets.githubusercontent.com/fixture?signature=synthetic" } });
      return new Response("0123456789"); // Right size, intentionally wrong SHA.
    },
  }), /frozen_asset_bytes_mismatch/);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].init.redirect, "manual");
  assert.equal(calls[2].init.headers.Authorization, undefined);
  assert.equal(calls[2].init.redirect, "error");
  assert.ok(calls[1].url.endsWith(`/releases/assets/${OLD.assetId}`));
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("unexpected download redirect is refused before any request to the foreign host", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-redirect-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  let requests = 0;
  await assert.rejects(downloadOldInstaller({
    directory, token: "synthetic", async fetcher() {
      requests++;
      return requests === 1 ? Response.json(release()) : new Response(null, { status: 302,
        headers: { location: "https://attacker.example/installer?token=synthetic" } });
    },
  }), /untrusted_asset_redirect/);
  assert.equal(requests, 2);
  assert.equal(safeCode(new Error("Bearer synthetic\nhttps://private.example")), "unexpected_failure");
});

test("actual PowerShell outcome, environment whitelist and PID tracking functions pass isolated mocks", t => {
  const executable = process.env.WINDOWS_UPGRADE_PWSH || "pwsh";
  const probe = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { t.skip("pwsh is unavailable; workflow executes this test on Windows"); return; }
  assert.equal(probe.status, 0, probe.stderr);
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = "Stop"
    Set-StrictMode -Version Latest
    $tokens = $null; $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:WINDOWS_UPGRADE_PS_FILE, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "parse failed" }
    foreach ($name in @("Assert-Condition", "Get-AcceptanceOutcome", "Get-BaseEnvironment", "Test-CimProcessIdentity", "Capture-OwnedDescendants", "Get-EdgeDriverCandidates")) {
      $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name}, $true)
      if (!$function) { throw "missing function" }
      Invoke-Expression $function.Extent.Text
    }
    $script:upstreamVersion = "131.0.2903.146"
    function Invoke-WebRequest { param($Uri, $TimeoutSec)
      if ($Uri -cne "https://msedgedriver.microsoft.com/LATEST_RELEASE_131_WINDOWS") { throw "wrong Microsoft endpoint" }
      $bytes = [System.Text.Encoding]::Unicode.GetPreamble() + [System.Text.Encoding]::Unicode.GetBytes("$script:upstreamVersion\`r\`n")
      return @{RawContentStream=[System.IO.MemoryStream]::new([byte[]]$bytes)}
    }
    $versions = @(Get-EdgeDriverCandidates "131.0.2903.48")
    if ($versions.Count -ne 2 -or $versions[0] -cne "131.0.2903.48" -or $versions[1] -cne $script:upstreamVersion) { throw "UTF16 driver version lookup failed" }
    $script:upstreamVersion = "131.0.2904.146"
    $versions = @(Get-EdgeDriverCandidates "131.0.2903.48")
    if ($versions.Count -ne 1 -or $versions[0] -cne "131.0.2903.48") { throw "wrong driver build accepted" }
    $checks = @(@{ name="driver"; status="passed" })
    $good = Get-AcceptanceOutcome "preflight" "passed" "passed" $checks
    if ($good.status -cne "preflight_passed" -or !$good.preflightPassed -or $good.actualUpgradePassed) { throw "wrong preflight outcome" }
    foreach ($case in @(
      @("preflight","blocked","passed",$checks),
      @("preflight","passed","failed",$checks),
      @("preflight","passed","passed",@()),
      @("preflight","passed","passed",@(@{name="driver";status="blocked"})),
      @("preflight","passed","passed",@(@{name="pointer";status="failed"})),
      @("upgrade","passed","passed",$checks)
    )) {
      $value = Get-AcceptanceOutcome $case[0] $case[1] $case[2] $case[3]
      if ($value.status -ceq "preflight_passed" -or $value.actualUpgradePassed) { throw "false green" }
    }
    $upgrade = Get-AcceptanceOutcome "upgrade" "passed" "passed" @($checks[0],@{name="upgrade-executor";status="blocked"})
    if (!$upgrade.preflightPassed -or $upgrade.status -cne "blocked") { throw "lost preflight/upgrade boundary" }
    $env:SystemRoot = [System.IO.Path]::GetTempPath()
    $env:GITHUB_TOKEN="synthetic"; $env:ACTIONS_RUNTIME_TOKEN="synthetic"
    $env:OPENAI_API_KEY="synthetic"; $env:NODE_OPTIONS="synthetic"; $env:EDUPI_DATA_ROOT="synthetic"
    $clean = Get-BaseEnvironment
    foreach ($name in @("GITHUB_TOKEN","ACTIONS_RUNTIME_TOKEN","OPENAI_API_KEY","NODE_OPTIONS","EDUPI_DATA_ROOT","GH_TOKEN")) {
      if ($clean.ContainsKey($name)) { throw "credential or root inherited" }
    }
    if ($clean.PATH -cne "$(Join-Path $env:SystemRoot 'System32');$env:SystemRoot") { throw "ambient PATH inherited" }
    # Mock only process records. No Windows API, installer or App is invoked.
    $time = [datetime]::new(2026,11,17,0,0,0,[DateTimeKind]::Utc)
    $script:ownedProcesses = [System.Collections.Generic.List[object]]::new()
    $script:ownedProcesses.Add(@{ id=10; started=$time; file="/synthetic/app" })
    $script:processes = @{
      10=@{Id=10;StartTime=$time;Path="/synthetic/app";HasExited=$false;SafeHandle=1}
      11=@{Id=11;StartTime=$time.AddSeconds(1);Path="/synthetic/child";HasExited=$false;SafeHandle=2}
      12=@{Id=12;StartTime=$time.AddSeconds(2);Path="/synthetic/grandchild";HasExited=$false;SafeHandle=3}
      13=@{Id=13;StartTime=$time;Path="/unrelated/process";HasExited=$false;SafeHandle=4}
      14=@{Id=14;StartTime=$time.AddSeconds(-1);Path="/unrelated/older";HasExited=$false;SafeHandle=5}
      15=@{Id=15;StartTime=$time.AddSeconds(9);Path="/synthetic/reused";HasExited=$false;SafeHandle=6}
    }
    function Get-Process { param([int]$Id, $ErrorAction) return $script:processes[$Id] }
    $script:snapshot = @(
      @{ProcessId=10;ParentProcessId=1;CreationDate=$time;ExecutablePath="/synthetic/app"},
      @{ProcessId=12;ParentProcessId=11;CreationDate=$time.AddSeconds(2);ExecutablePath="/synthetic/grandchild"},
      @{ProcessId=13;ParentProcessId=99;CreationDate=$time;ExecutablePath="/unrelated/process"},
      @{ProcessId=11;ParentProcessId=10;CreationDate=$time.AddSeconds(1);ExecutablePath="/synthetic/child"},
      @{ProcessId=14;ParentProcessId=10;CreationDate=$time.AddSeconds(-1);ExecutablePath="/unrelated/older"},
      @{ProcessId=15;ParentProcessId=10;CreationDate=$time.AddSeconds(3);ExecutablePath="/synthetic/reused"}
    )
    function Get-CimInstance { param($ClassName) return $script:snapshot }
    $ids = Capture-OwnedDescendants
    if ($ids -isnot [System.Collections.Generic.HashSet[int]] -or $ids.Count -ne 3 -or $ids.Contains(13) -or
        $ids.Contains(14) -or $ids.Contains(15)) { throw "PID ancestry and birth guard failed" }
    $script:ownedProcesses = [System.Collections.Generic.List[object]]::new()
    $script:ownedProcesses.Add(@{id=10;started=$time;file="/synthetic/app"})
    $script:snapshot[0].CreationDate = $time.AddDays(-1)
    $ids = Capture-OwnedDescendants
    if ($ids.Count -ne 1 -or !$ids.Contains(10)) { throw "stale parent CIM snapshot was trusted" }
    $script:ownedProcesses = [System.Collections.Generic.List[object]]::new()
    $script:ownedProcesses.Add(@{id=10;started=$time.AddDays(-1);file="/synthetic/app"})
    $ids = Capture-OwnedDescendants
    if ($ids.Count -ne 0) { throw "reused PID was trusted" }
    "PowerShell mocks passed"
  `], { encoding: "utf8", env: { ...process.env,
    WINDOWS_UPGRADE_PS_FILE: fileURLToPath(new URL("./test-windows-upgrade-acceptance.ps1", import.meta.url)) } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PowerShell mocks passed/u);
});

test("Windows cleanup uses retained process handles without an unchecked tree kill", () => {
  const source = fs.readFileSync(new URL("./test-windows-upgrade-acceptance.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(source, /taskkill|Kill\(\$true\)|Stop-Process\s+-Id/u);
  assert.match(source, /\$current = \$record\.process[\s\S]*\$current\.SafeHandle[\s\S]*\$current\.Kill\(\)/u);
});

test("imports have no environment, cwd, file or process side effects", () => {
  const files = ["windows-upgrade-support.mjs", "windows-upgrade-webdriver.mjs"]
    .map(name => new URL(name, import.meta.url).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const env = {...process.env}, cwd = process.cwd(), listeners = process.eventNames();
    for (const file of ${JSON.stringify(files)}) await import(file);
    assert.deepEqual({...process.env}, env);
    assert.equal(process.cwd(), cwd);
    assert.deepEqual(process.eventNames(), listeners);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
