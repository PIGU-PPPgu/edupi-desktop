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
    foreach ($name in @("Assert-Condition", "Get-SafeDiagnostic", "Get-AcceptanceOutcome", "Get-BaseEnvironment", "Get-ApplicationExecutable", "Start-OwnedProcess", "Save-ProfileJournal", "Save-RecoveryProcesses", "Test-OwnedDebugEndpoint", "Test-CimProcessIdentity", "Capture-OwnedDescendants", "Get-EdgeDriverCandidates")) {
      $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name}, $true)
      if (!$function) { throw "missing function" }
      Invoke-Expression $function.Extent.Text
    }
    foreach ($url in @("ws://127.0.0.1:9222/devtools/browser", "ws://localhost:9222/devtools/browser/synthetic")) {
      if (!(Test-OwnedDebugEndpoint $url 9222)) { throw "valid owned WebView endpoint rejected" }
    }
    foreach ($url in @("ws://remote.example:9222/devtools/browser", "ws://127.0.0.1:9333/devtools/browser",
      "http://127.0.0.1:9222/devtools/browser", "ws://user:secret@127.0.0.1:9222/devtools/browser",
      "ws://127.0.0.1:9222/devtools/browser?token=secret")) {
      if (Test-OwnedDebugEndpoint $url 9222) { throw "foreign debug endpoint accepted" }
    }
    try {
      $inner = [System.ComponentModel.Win32Exception]::new(5, "synthetic-token C:\\Users\\private\\secret")
      throw [System.InvalidOperationException]::new("Bearer synthetic-token C:\\private\\path", $inner)
    } catch { $diagnostic = Get-SafeDiagnostic $_ "real-webview-helper-start" }
    if ($diagnostic.scriptLineNumber -le 0 -or $diagnostic.exceptions.Count -ne 2 -or
        $diagnostic.exceptions[1].nativeErrorCode -ne 5 -or
        $diagnostic.exceptions[0].type -cne "System.InvalidOperationException") { throw "exception identity lost" }
    $safeJson = $diagnostic | ConvertTo-Json -Depth 8 -Compress
    if ($safeJson.Contains("synthetic-token") -or $safeJson.Contains("private") -or $safeJson.Contains("Bearer")) { throw "diagnostic leaked error message" }
    $realNode = $env:WINDOWS_UPGRADE_REAL_NODE
    $script:commandCandidates = @(@{Source=$realNode}, @{Source="$realNode-synthetic-second-path"})
    function Get-Command { param($Name, $CommandType) return $script:commandCandidates }
    $chosen = Get-ApplicationExecutable "node"
    if ($chosen -isnot [string] -or $chosen -cne $realNode) { throw "array of executable paths was not resolved" }
    $taskRoot = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "windows-upgrade-resolver-$([guid]::NewGuid().ToString('N'))")
    [void][System.IO.Directory]::CreateDirectory($taskRoot)
    $script:ownedProcesses = [System.Collections.Generic.List[object]]::new()
    try {
      try {
        $bad = Start-OwnedProcess -File $script:commandCandidates.Source -Arguments @("--version") -Environment @{}
        throw "combined executable paths unexpectedly launched"
      } catch {
        $broken = Get-SafeDiagnostic $_ "resolver-regression"
        if (!@($broken.exceptions | Where-Object {$_.nativeErrorCode -eq 2}).Count) { throw "old file-not-found failure was not reproduced" }
      }
      $env:WINDOWS_UPGRADE_DOWNLOAD_DIR=$taskRoot
      $script:resourceJournal=@{processStartPending=$false;processes=@()}
      $child = Start-OwnedProcess -File $chosen -Arguments @("--version") -Environment @{}
      if (!$child.WaitForExit(10000) -or $child.ExitCode -ne 0) { throw "resolved Node did not start" }
      if ($script:ownedProcesses[0].stdout.Result -cnotmatch '^v[0-9]+\\.') { throw "resolved Node output missing" }
      $child.Dispose()
      $file=Join-Path $taskRoot "resource-recovery.json"
      $saved=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
      if($saved.processStartPending -or @($saved.processes).Count -ne 1){throw "started process identity was not checkpointed"}
      try{Start-OwnedProcess -File "$chosen-synthetic-missing" -Arguments @() -Environment @{};throw "missing executable started"}
      catch{if(!(Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).processStartPending){throw "uncheckpointed launch was green"}}
      $script:resourceJournal=$null
    } finally { [System.IO.Directory]::Delete($taskRoot,$true) }
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
    $checks = @("exact-116-installer","isolated-environment","installed-116-core98-bytes",
      "webview2-runtime","edge-driver","tauri-driver","real-webview-preflight") |
      ForEach-Object { @{name=$_;status="passed"} }
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
    $upgrade = Get-AcceptanceOutcome "upgrade" "passed" "passed" @($checks + @(@{name="upgrade-executor";status="blocked"}))
    if (!$upgrade.preflightPassed -or $upgrade.status -cne "blocked") { throw "lost preflight/upgrade boundary" }
    $all = @($checks) + @("native-upgrade-gate","public-117-target","profile-environment-set","old-ui-native-upgrade",
      "automatic-117-restart","installed-117-core98-bytes","same-object-upgrade-readback","profile-environment-restored" |
      ForEach-Object { @{name=$_;status="passed"} })
    $full = Get-AcceptanceOutcome "upgrade" "passed" "passed" $all
    if (!$full.actualUpgradePassed -or $full.status -cne "upgrade_passed") { throw "complete upgrade cannot pass" }
    foreach ($index in 0..($all.Count-1)) {
      $negative = @($all | ForEach-Object { $_.Clone() })
      $negative[$index].status = "blocked"
      if ((Get-AcceptanceOutcome "upgrade" "passed" "passed" $negative).actualUpgradePassed) { throw "missing upgrade gate was green" }
      $negative = @($all[0..($all.Count-1)] | Where-Object { $_.name -cne $all[$index].name })
      if ((Get-AcceptanceOutcome "upgrade" "passed" "passed" $negative).actualUpgradePassed) { throw "absent upgrade gate was green" }
    }
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
    WINDOWS_UPGRADE_PS_FILE: fileURLToPath(new URL("./test-windows-upgrade-acceptance.ps1", import.meta.url)),
    WINDOWS_UPGRADE_REAL_NODE: process.execPath } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PowerShell mocks passed/u);
});

test("Windows cleanup uses retained process handles without an unchecked tree kill", () => {
  const source = fs.readFileSync(new URL("./test-windows-upgrade-acceptance.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(source, /taskkill|Kill\(\$true\)|Stop-Process\s+-Id/u);
  assert.match(source, /\$current = \$record\.process[\s\S]*\$current\.SafeHandle[\s\S]*\$current\.Kill\(\)/u);
  assert.doesNotMatch(source, /AdjustTokenPrivileges|CreateRestrictedToken|EnableLUA|no-sandbox|ignore-certificate-errors|do-not-de-elevate/u);
  assert.match(source, /OpenProcess\(0x1000, false, processId\)/u);
  assert.match(source, /OpenProcessToken\(process, 0x0008, out token\)/u);
  assert.match(source, /Start-ResourceJournal \$downloadDir\s+New-PrivateDirectory \$taskRoot/u);
  assert.match(source, /\$resourceJournal\.installation = "started"\s+Save-ProfileJournal[\s\S]*?\$installation = Start-OwnedProcess -File \$installer/u);
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

function powershellMocks(t, names, program) {
  const executable = process.env.WINDOWS_UPGRADE_PWSH || "pwsh";
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference="Stop"; Set-StrictMode -Version Latest
    $tokens=$null; $errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:WINDOWS_UPGRADE_PS_FILE,[ref]$tokens,[ref]$errors)
    if($errors.Count){throw "PowerShell AST errors"}
    foreach($name in @(${["Assert-Condition", ...names].map(name => `"${name}"`).join(",")})){
      $definition=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
      if(!$definition){throw "missing test function"}; Invoke-Expression $definition.Extent.Text
    }
    ${program}
    "Upgrade PowerShell mocks passed"
  `], { encoding: "utf8", timeout: 30_000, env: { ...process.env,
    WINDOWS_UPGRADE_PS_FILE: fileURLToPath(new URL("./test-windows-upgrade-acceptance.ps1", import.meta.url)) } });
  if (result.error?.code === "ENOENT") { t.skip("pwsh unavailable; Windows workflow runs these mocks"); return; }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Upgrade PowerShell mocks passed/u);
}

test("actual PowerShell refuses hosted, elevated, session-zero and missing-shell upgrade without changing the profile", t => {
  powershellMocks(t, ["Assert-NativeUpgradeGate", "Start-OldApplication"], `
    $valid=@{status="passed";shellWindowPresent=$true;sidMatches=$true;sessionMatches=$true;
      currentSessionId=2;currentTokenElevated=$false;shellTokenElevated=$false}
    Assert-NativeUpgradeGate $valid "native-windows"
    foreach($field in @("status","shellWindowPresent","sidMatches","sessionMatches","currentSessionId","currentTokenElevated","shellTokenElevated")){
      $bad=$valid.Clone()
      $bad[$field]=switch($field){"status"{"blocked"};"currentSessionId"{0};"currentTokenElevated"{$true};"shellTokenElevated"{$true};default{$false}}
      $rejected=$false
      try{Assert-NativeUpgradeGate $bad "native-windows"}catch{$rejected=$true}
      if(!$rejected){throw "unsafe native gate accepted"}
    }
    $rejected=$false;try{Assert-NativeUpgradeGate $valid "hosted-windows"}catch{$rejected=$true}
    if(!$rejected){throw "hosted upgrade accepted"}
    $script:launches=0; $application="/synthetic/pi-agent-desktop.exe"; $appEnvironment=@{}
    $script:version="0.3.117"
    function Get-Item {param($LiteralPath) return @{VersionInfo=@{ProductVersion=$script:version}}}
    function Start-OwnedProcess {param($File,$Environment,$Arguments) $script:launches++ }
    $rejected=$false;try{Start-OldApplication}catch{$rejected=$_.Exception.Message -ceq "only_frozen_116_may_be_launched"}
    if(!$rejected -or $script:launches -ne 0){throw "117 was manually launched"}
    $script:version="0.3.116"; Start-OldApplication
    if($script:launches -ne 1){throw "116 launch was not executed"}
  `);
});

test("actual Read-UserEnvironment handles absent and single registry names under StrictMode without losing case or raw values", t => {
  powershellMocks(t, [], `
    # Substitute only the unavailable HKCU boundary; execute the production reader.
    $definition=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $n.Name -ceq "Read-UserEnvironment"},$true)
    Invoke-Expression ($definition.Extent.Text.Replace('[Microsoft.Win32.Registry]::CurrentUser','$script:registryHive'))
    $script:key=$null
    $script:registryHive=[pscustomobject]@{}
    $script:registryHive | Add-Member ScriptMethod OpenSubKey {param($Path,$Writable)
      if($Path -cne "Environment" -or $Writable){throw "wrong registry access"}
      return $script:key
    }
    $absent=Read-UserEnvironment "TEMP"
    if($absent.exists -or $absent.name -cne "TEMP" -or $null -ne $absent.value){throw "absent key was not preserved"}
    $script:names=@();$script:disposed=$false
    $script:key=[pscustomobject]@{}
    $script:key | Add-Member ScriptMethod GetValueNames {return $script:names}
    $script:key | Add-Member ScriptMethod GetValueKind {param($Name)
      if($Name -cne "Temp"){throw "registry name was truncated or case changed"}
      return [Microsoft.Win32.RegistryValueKind]::ExpandString
    }
    $script:key | Add-Member ScriptMethod GetValue {param($Name,$Default,$Options)
      if($Name -cne "Temp" -or $null -ne $Default -or
        $Options -ne [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames){throw "raw registry read changed"}
      return '%USERPROFILE%\\literal-$-private'
    }
    $script:key | Add-Member ScriptMethod Dispose {$script:disposed=$true}
    foreach($names in @(@(),@("Other"),@("Other","Temp"))){
      $script:names=$names;$script:disposed=$false
      $entry=Read-UserEnvironment "TEMP"
      if(!$script:disposed){throw "registry key was not disposed"}
      if("Temp" -cin $names){
        if(!$entry.exists -or $entry.name -cne "Temp" -or $entry.kind -ne 2 -or
          $entry.value -cne '%USERPROFILE%\\literal-$-private'){throw "single raw registry entry changed"}
      }elseif($entry.exists -or $entry.name -cne "TEMP" -or $null -ne $entry.kind){throw "zero matches were not preserved"}
    }
    $script:names=@("Temp","TEMP");$rejected=$false
    try{Read-UserEnvironment "TEMP"}catch{$rejected=$_.Exception.Message -ceq "ambiguous_profile_environment"}
    if(!$rejected -or !$script:disposed){throw "ambiguous names were accepted"}
  `);
});

test("actual PowerShell env transaction restores raw names, absence, ExpandString and partial failures with broadcast", t => {
  powershellMocks(t, ["Get-ProfileEnvironmentNames", "Test-EnvironmentEntryEqual", "Start-ProfileEnvironment",
    "Restore-ProfileEnvironment"], `
    function Get-CurrentUserSid {return "S-1-5-21-synthetic"}
    $script:registry=@{}; $script:broadcasts=0; $script:writes=0; $script:failAt=0; $script:failBroadcast=$false
    $script:journals=[Collections.Generic.List[object]]::new()
    function Read-UserEnvironment {param($Name)
      if($script:registry.ContainsKey($Name)){return $script:registry[$Name].Clone()}
      return @{name=$Name;exists=$false;kind=$null;value=$null}
    }
    function Write-UserEnvironment {param($Entry)
      $script:writes++
      if($script:writes -eq $script:failAt){throw "mock registry write failed"}
      if($Entry.exists){$script:registry[$Entry.name]=$Entry.Clone()}else{$script:registry.Remove($Entry.name)}
    }
    function Send-EnvironmentChange {
      $script:broadcasts++
      if($script:failBroadcast){$script:failBroadcast=$false;throw "mock broadcast failed"}
    }
    function Save-ProfileJournal {param($Journal,$File)
      $script:journals.Add(($Journal | ConvertTo-Json -Depth 12 -Compress))
    }
    $env:GITHUB_RUN_ID="123";$env:GITHUB_RUN_ATTEMPT="1"
    $taskRoot="/synthetic/task";$canaryRoot="/synthetic/canary";$destination="/synthetic/task/application"
    $script:resourceJournal=@{environmentStarted=$false}
    $script:ownedDirectories=[Collections.Generic.List[string]]::new()
    $original=@{
      "Temp"=@{name="Temp";exists=$true;kind=2;value="%USERPROFILE%\\literal-$-private"}
      "PI_OFFLINE"=@{name="PI_OFFLINE";exists=$true;kind=1;value=""}
    }
    $values=@{};foreach($name in (Get-ProfileEnvironmentNames)){$values[$name]="synthetic-$name"}
    foreach($scenario in @("success","partial-write","broadcast")){
      $script:registry=@{};foreach($name in $original.Keys){$script:registry[$name]=$original[$name].Clone()}
      $script:writes=0;$script:failAt=if($scenario -ceq "partial-write"){4}else{0}
      $script:failBroadcast=$scenario -ceq "broadcast";$script:profileJournal=$null
      $failed=$false
      try{$active=Start-ProfileEnvironment $values "/private/raw-backup.json"}catch{$failed=$true}
      if(($scenario -ceq "success") -eq $failed){throw "transaction failure was hidden"}
      if(!$script:profileJournal -or !$script:journals[0].Contains('"prepared"')){throw "backup not durable before mutation"}
      if($scenario -ceq "success"){
        foreach($name in $values.Keys){if((Read-UserEnvironment $name).value -cne $values[$name]){throw "profile value not set"}}
      }
      $script:failAt=0;Restore-ProfileEnvironment $script:profileJournal "/private/raw-backup.json"
      if($script:registry.Count -ne 2){throw "original absent entries were not removed"}
      foreach($name in $original.Keys){if(!(Test-EnvironmentEntryEqual $original[$name] (Read-UserEnvironment $name))){throw "raw original changed"}}
      Restore-ProfileEnvironment $script:profileJournal "/private/raw-backup.json"
      if($script:profileJournal.status -cne "restored"){throw "restore was not idempotent"}
    }
    $script:writes=0;$script:failAt=1
    $failed=$false;try{Restore-ProfileEnvironment $script:profileJournal "/private/raw-backup.json"}catch{$failed=$true}
    if(!$failed){throw "restore write failure was green"}
    if($script:broadcasts -lt 9){throw "profile updates were not broadcast"}
  `);
});

test("actual PowerShell historical ancestry rejects PID reuse and installer-parent gaps after old exit", t => {
  powershellMocks(t, ["Test-HistoricalParent"], `
    $birth=[datetime]::new(2026,11,17,0,0,0,[DateTimeKind]::Utc)
    $parent=@{id=10;started=$birth;file="/private/app";process=@{
      HasExited=$false;StartTime=$birth;Path="/private/app";ExitTime=$birth.AddSeconds(3)}}
    $child=@{ParentProcessId=10;CreationDate=$birth.AddSeconds(1)}
    if(!(Test-HistoricalParent $parent $child)){throw "live retained parent rejected"}
    $parent.process.HasExited=$true
    if(!(Test-HistoricalParent $parent $child)){throw "historical retained parent rejected"}
    foreach($case in @(
      @{ParentProcessId=11;CreationDate=$birth.AddSeconds(1)},
      @{ParentProcessId=10;CreationDate=$birth.AddSeconds(-1)},
      @{ParentProcessId=10;CreationDate=$birth.AddSeconds(4)}
    )){if(Test-HistoricalParent $parent $case){throw "reused or unrelated PID accepted"}}
    $parent.process.HasExited=$false;$parent.process.StartTime=$birth.AddSeconds(1)
    if(Test-HistoricalParent $parent $child){throw "changed retained identity accepted"}
  `);
});

test("actual PowerShell transition observer requires native hashed NSIS ancestry, correct user, safe arguments and automatic new PID", t => {
  powershellMocks(t, ["Test-CimProcessIdentity", "Test-HistoricalParent", "Assert-UpgradeProcessUser", "Capture-UpgradeTransition"], `
    $taskRoot=[IO.Path]::Combine([IO.Path]::GetTempPath(),"windows-upgrade-observer-synthetic")
    $application=[IO.Path]::Combine($taskRoot,"application","pi-agent-desktop.exe")
    $targetHash="5c7dab4a4966333228771bc5b8f43953d4df191bd187dc33779034d1d6fbeb6f"
    $installer=[IO.Path]::Combine($taskRoot,"temp","native-117-installer.exe")
    $time=[datetime]::new(2026,11,17,0,0,0,[DateTimeKind]::Utc)
    $script:upgradeBoundary=$time.AddSeconds(1)
    $old=@{id=100;started=$time;file=$application;process=@{HasExited=$true;ExitTime=$time.AddSeconds(4)}}
    $script:hash=$targetHash;$script:elevated=$false;$script:ownerSid="synthetic-sid";$script:saves=0
    function Get-CurrentUserSid {return "synthetic-sid"}
    function Get-ProcessElevation {param($ProcessId) return $script:elevated}
    function Invoke-CimMethod {param($InputObject,$MethodName) return @{ReturnValue=0;Sid=$script:ownerSid}}
    function Get-CimInstance {param($ClassName) return $script:rows}
    function Get-Process {param($Id,$ErrorAction) return $script:processes[[int]$Id]}
    function Get-FileHash {param($LiteralPath,$Algorithm) return @{Hash=$script:hash}}
    function Get-Item {param($LiteralPath) return @{VersionInfo=@{ProductVersion="0.3.117"}}}
    function Assert-NoReparseAncestor {param($Path)}
    function Save-RecoveryProcesses {$script:saves++}
    $session=[Diagnostics.Process]::GetCurrentProcess().SessionId
    function Reset-Transition {
      $script:ownedProcesses=[Collections.Generic.List[object]]::new();$script:ownedProcesses.Add($old)
      $script:upgradeInstaller=$null;$script:newApplication=$null
      $script:processes=@{
        101=@{Id=101;StartTime=$time.AddSeconds(2);Path=$installer;SafeHandle=1;HasExited=$false;ExitTime=$time.AddSeconds(6)}
        102=@{Id=102;StartTime=$time.AddSeconds(5);Path=$application;SafeHandle=2;HasExited=$false}
      }
      # Deliberately list the new App before its installer: CIM order is not provenance.
      $script:rows=@(
        @{ProcessId=102;ParentProcessId=101;CreationDate=$time.AddSeconds(5);ExecutablePath=$application;SessionId=$session;CommandLine=""},
        @{ProcessId=101;ParentProcessId=100;CreationDate=$time.AddSeconds(2);ExecutablePath=$installer;SessionId=$session;
          CommandLine='"private-native-installer.exe" /P /UPDATE /R /ARGS --safe-mode'}
      )
      $script:hash=$targetHash;$script:elevated=$false;$script:ownerSid="synthetic-sid"
    }
    Reset-Transition; Capture-UpgradeTransition $old
    if(!$script:newApplication -or $script:newApplication.id -ne 102 -or $script:upgradeInstaller.id -ne 101 -or
      $script:ownedProcesses.Count -ne 3 -or $script:saves -lt 2){throw "verified automatic transition lost"}
    Capture-UpgradeTransition $old
    if($script:ownedProcesses.Count -ne 3){throw "retained process records duplicated"}
    foreach($scenario in @("wrong-hash","elevated","other-user","missing-restart","shell-parent","reused-parent")){
      Reset-Transition
      switch($scenario){
        "wrong-hash" {$script:hash="0"*64}
        "elevated" {$script:elevated=$true}
        "other-user" {$script:ownerSid="other-sid"}
        "missing-restart" {$script:rows[1].CommandLine='/P /UPDATE /ARGS --safe-mode'}
        "shell-parent" {$script:rows[0].ParentProcessId=999}
        "reused-parent" {$script:rows[1].CreationDate=$time.AddSeconds(9);$script:processes[101].StartTime=$time.AddSeconds(9)}
      }
      $failed=$false;try{Capture-UpgradeTransition $old}catch{$failed=$true}
      if(!$failed -or $script:newApplication){throw "unsafe transition accepted"}
    }
  `);
});

test("actual PowerShell durable journal atomically retains raw backup and validates recovery ownership", t => {
  powershellMocks(t, ["Save-ProfileJournal", "Start-ResourceJournal", "Get-ProfileEnvironmentNames", "Recover-ProfileEnvironment"], `
    $temp=[IO.Path]::Combine([IO.Path]::GetTempPath(),"windows-upgrade-journal-"+[guid]::NewGuid().ToString("N"))
    [void][IO.Directory]::CreateDirectory($temp)
    try{
      $env:USERPROFILE=$temp;$env:APPDATA=Join-Path $temp "appdata";$env:LOCALAPPDATA=Join-Path $temp "localappdata"
      $env:GITHUB_RUN_ID="123";$env:GITHUB_RUN_ATTEMPT="2"
      $taskRoot=Join-Path $temp ("edupi-windows-upgrade-"+("a"*32))
      $canaryRoot=Join-Path $temp ("edupi-route1-canary-windows-upgrade-"+("a"*32))
      $destination=Join-Path $taskRoot "application"
      function Get-CurrentUserSid {return "synthetic"}
      function Assert-NoReparseAncestor {param($Path)}
      Start-ResourceJournal $temp
      $file=Join-Path $temp "user-environment-backup.json"
      $journal=@{schemaVersion=1;runId="123";attempt="2";sid="synthetic";status="prepared";entries=@();
        taskRoot=$taskRoot;canaryRoot=$canaryRoot;destination=$destination;
        raw=@{name="Temp";kind=2;value="%USERPROFILE%\\literal"}}
      Save-ProfileJournal $journal $file
      $read=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json -AsHashtable
      if($read.raw.value -cne $journal.raw.value -or $read.raw.kind -ne 2){throw "raw journal changed"}
      $journal.status="active";Save-ProfileJournal $journal $file
      if((Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).status -cne "active" -or (Test-Path "$file.next")){throw "journal replacement incomplete"}
      $rejected=$false;try{Recover-ProfileEnvironment $temp}catch{$rejected=$_.Exception.Message -ceq "profile_recovery_keys_mismatch"}
      if(!$rejected){throw "invalid recovery key set accepted"}
      $journal.runId="other";Save-ProfileJournal $journal $file
      $rejected=$false;try{Recover-ProfileEnvironment $temp}catch{$rejected=$_.Exception.Message -ceq "profile_recovery_identity_mismatch"}
      if(!$rejected){throw "other run backup accepted"}
    }finally{if($script:profileLease){$script:profileLease.Dispose()};[IO.Directory]::Delete($temp,$true)}
  `);
});

test("actual PowerShell always recovery stops owned processes before restoring env and removing marked private dirs", t => {
  powershellMocks(t, ["Get-ProfileEnvironmentNames", "Test-EnvironmentEntryEqual", "Save-ProfileJournal",
    "Restore-ProfileEnvironment", "Remove-RecoveryDirectories", "Recover-ProfileEnvironment"], `
    $temp=[IO.Path]::Combine([IO.Path]::GetTempPath(),"windows-upgrade-recovery-"+[guid]::NewGuid().ToString("N"))
    [void][IO.Directory]::CreateDirectory($temp)
    try{
      $env:USERPROFILE=$temp;$env:APPDATA=Join-Path $temp "appdata";$env:LOCALAPPDATA=Join-Path $temp "localappdata"
      $env:GITHUB_RUN_ID="123";$env:GITHUB_RUN_ATTEMPT="2"
      $task=Join-Path $temp ("edupi-windows-upgrade-"+("a"*32))
      $canary=Join-Path $temp ("edupi-route1-canary-windows-upgrade-"+("a"*32))
      foreach($folder in @($task,$canary)){
        [void][IO.Directory]::CreateDirectory($folder)
        [IO.File]::WriteAllText((Join-Path $folder ".windows-upgrade-owned"),"123-2")
      }
      $script:stopped=$false;$script:broadcasted=$false;$script:registry=@{}
      function Get-CurrentUserSid {return "synthetic"}
      function Assert-NoReparseAncestor {param($Path)}
      function Get-CimInstance {param($ClassName) return @()}
      function Stop-TaskProcesses {$script:stopped=$true}
      function Assert-NoUpgradeInstallation {param($Code)}
      function Read-UserEnvironment {param($Name)
        if($script:registry.ContainsKey($Name)){return $script:registry[$Name].Clone()}
        return @{name=$Name;exists=$false;kind=$null;value=$null}
      }
      function Write-UserEnvironment {param($Entry)
        if(!$script:stopped){throw "restored before stopping owned native processes"}
        if($Entry.exists){$script:registry[$Entry.name]=$Entry.Clone()}else{$script:registry.Remove($Entry.name)}
      }
      function Send-EnvironmentChange {$script:broadcasted=$true}
      $entries=@(Get-ProfileEnvironmentNames | ForEach-Object { @{name=$_;exists=$false;kind=$null;value=$null} })
      $entries[0]=@{name=$entries[0].name;exists=$true;kind=2;value="%USERPROFILE%\\raw-original"}
      foreach($entry in $entries){$script:registry[$entry.name]=@{name=$entry.name;exists=$true;kind=1;value="active-task-value"}}
      $journal=@{schemaVersion=1;runId="123";attempt="2";sid="synthetic";status="active";entries=$entries;
        taskRoot=$task;canaryRoot=$canary;destination=(Join-Path $task "application");processes=@();directories=@($task,$canary)}
      $resources=$journal.Clone();$resources.Remove("entries")
      $resources.sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
      $resources.installation="not_started";$resources.environmentStarted=$true
      $resources.processStartPending=$false
      Save-ProfileJournal $resources (Join-Path $temp "resource-recovery.json")
      $file=Join-Path $temp "user-environment-backup.json"
      Save-ProfileJournal $journal $file
      [IO.File]::WriteAllText((Join-Path $temp ".edupi-windows-upgrade-env.lock"),"123-2")
      Recover-ProfileEnvironment $temp
      if(!$script:stopped -or !$script:broadcasted -or $script:registry.Count -ne 1 -or
        !(Test-EnvironmentEntryEqual $entries[0] (Read-UserEnvironment $entries[0].name))){throw "cross-step exact env recovery failed"}
      if((Test-Path $task) -or (Test-Path $canary) -or (Test-Path (Join-Path $temp ".edupi-windows-upgrade-env.lock"))){throw "marked private recovery dirs or lease remain"}
      Recover-ProfileEnvironment $temp
      if((Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).status -cne "restored"){throw "recovery journal state lost"}
    }finally{[IO.Directory]::Delete($temp,$true)}
  `);
});

test("actual PowerShell resource journal recovers before env starts and refuses missing, partial, conflicting or interrupted cleanup", t => {
  powershellMocks(t, ["Save-ProfileJournal", "Start-ResourceJournal", "Save-RecoveryProcesses",
    "Remove-RecoveryDirectories", "Recover-ProfileEnvironment"], `
    $temp=[IO.Path]::Combine([IO.Path]::GetTempPath(),"windows-upgrade-resource-"+[guid]::NewGuid().ToString("N"))
    [void][IO.Directory]::CreateDirectory($temp)
    $script:realSave=\${function:Save-ProfileJournal}
    function Save-ProfileJournal {param($Journal,$File)
      if($script:scenario -ceq "save-interrupted" -and $Journal.status -ceq "restored"){throw "synthetic_save_interrupted"}
      & $script:realSave $Journal $File
    }
    function Get-CurrentUserSid {return "synthetic"}
    function Assert-NoReparseAncestor {param($Path)}
    function Get-CimInstance {param($ClassName) return @()}
    function Stop-TaskProcesses {
      if($script:scenario -ceq "process-cleanup-fails"){throw "synthetic_process_cleanup_failed"}
      $script:stops++
    }
    function Get-BaseEnvironment {return @{}}
    function Start-OwnedProcess {param($File,$Environment,$RawArguments)
      if(!$script:stops -or $File -cne (Join-Path $destination "uninstall.exe") -or
        $RawArguments -cne "/S _?=$destination"){throw "unowned or premature uninstall"}
      if((Get-Content -LiteralPath $resourceFile -Raw | ConvertFrom-Json).installation -cne "started"){
        throw "installer intent was not durable"
      }
      $script:uninstalls++;return @{ExitCode=0}
    }
    function Wait-OwnedProcess {param($Process,$Seconds,$Code)
      if($script:scenario -ceq "uninstall-fails"){throw $Code}
      if($script:scenario -cne "registration-remains"){$script:registered=$false}
    }
    function Assert-NoUpgradeInstallation {param($Code)
      if($script:registered){throw $Code}
    }
    function Restore-ProfileEnvironment {param($Journal,$File) throw "environment recovery was not expected"}
    function Remove-Item {param($LiteralPath,[switch]$Recurse,[switch]$Force)
      if($script:scenario -ceq "remove-interrupted" -and $LiteralPath -ceq $canaryRoot){throw "synthetic_remove_interrupted"}
      Microsoft.PowerShell.Management\\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force
    }
    try{
      foreach($scenario in @("no-install","installed","missing-resource","partial-resource","wrong-run","wrong-sid",
        "wrong-session","unmarked-directory","foreign-directory","missing-env","partial-env","conflicting-env",
        "missing-uninstaller","uninstall-fails","registration-remains","process-cleanup-fails",
        "live-lease","uncheckpointed-process","false-restored","remove-interrupted","save-interrupted")){
        $script:scenario=$scenario;$script:stops=0;$script:uninstalls=0
        $caseRoot=Join-Path $temp $scenario
        [void][IO.Directory]::CreateDirectory($caseRoot)
        $env:USERPROFILE=$caseRoot;$env:APPDATA=Join-Path $caseRoot "appdata";$env:LOCALAPPDATA=Join-Path $caseRoot "localappdata"
        $env:GITHUB_RUN_ID="123";$env:GITHUB_RUN_ATTEMPT="2";$env:WINDOWS_UPGRADE_DOWNLOAD_DIR=$caseRoot
        $script:taskRoot=Join-Path $caseRoot ("edupi-windows-upgrade-"+("a"*32))
        $script:canaryRoot=Join-Path $caseRoot ("edupi-route1-canary-windows-upgrade-"+("a"*32))
        $script:destination=Join-Path $taskRoot "application"
        $script:ownedProcesses=[Collections.Generic.List[object]]::new();$script:profileJournal=$null
        Start-ResourceJournal $caseRoot
        $resourceFile=Join-Path $caseRoot "resource-recovery.json"
        if((Test-Path $taskRoot) -or (Test-Path $canaryRoot) -or
          (Test-Path (Join-Path $caseRoot "user-environment-backup.json"))){throw "resource journal was not created first"}
        foreach($folder in @($taskRoot,$canaryRoot)){
          [void][IO.Directory]::CreateDirectory($folder)
          [IO.File]::WriteAllText((Join-Path $folder ".windows-upgrade-owned"),"123-2")
        }
        $resourceJournal.directories=@($taskRoot,$canaryRoot)
        $script:registered=$scenario -cne "no-install"
        if($script:registered){
          $resourceJournal.installation="started"
          [void][IO.Directory]::CreateDirectory($destination)
          [IO.File]::WriteAllText((Join-Path $destination "uninstall.exe"),"synthetic bytes; never executed")
        }
        Save-RecoveryProcesses
        switch($scenario){
          "partial-resource" {$resourceJournal.Remove("installation")}
          "wrong-run" {$resourceJournal.runId="other"}
          "wrong-sid" {$resourceJournal.sid="other"}
          "wrong-session" {$resourceJournal.sessionId++}
          "uncheckpointed-process" {$resourceJournal.processStartPending=$true}
          "false-restored" {$resourceJournal.status="restored"}
          "unmarked-directory" {[IO.File]::WriteAllText((Join-Path $canaryRoot ".windows-upgrade-owned"),"other-run")}
          "foreign-directory" {$resourceJournal.directories+=@($caseRoot)}
          "missing-env" {$resourceJournal.environmentStarted=$true}
          "partial-env" {[IO.File]::WriteAllText((Join-Path $caseRoot "user-environment-backup.json.next"),'{"incomplete":')}
          "conflicting-env" {
            @{schemaVersion=1;runId="other";attempt="2";sid="synthetic"} | ConvertTo-Json |
              Set-Content -LiteralPath (Join-Path $caseRoot "user-environment-backup.json")
          }
          "missing-uninstaller" {[IO.File]::Delete((Join-Path $destination "uninstall.exe"))}
        }
        Save-ProfileJournal $resourceJournal $resourceFile
        if($scenario -ceq "missing-resource"){[IO.File]::Delete($resourceFile)}
        if($scenario -cne "live-lease"){$script:profileLease.Dispose()}
        $failed=$false
        try{Recover-ProfileEnvironment $caseRoot}catch{$failed=$true}
        $success=$scenario -cin @("no-install","installed")
        if($failed -eq $success){throw "recovery result mismatch: $scenario"}
        if($success){
          if((Test-Path $taskRoot) -or (Test-Path $canaryRoot) -or
            (Test-Path (Join-Path $caseRoot ".edupi-windows-upgrade-env.lock")) -or $script:registered -or
            (Get-Content -LiteralPath $resourceFile -Raw | ConvertFrom-Json).status -cne "restored"){throw "resources were not restored"}
          Recover-ProfileEnvironment $caseRoot
          if($script:uninstalls -ne [int]($scenario -ceq "installed")){throw "uninstall was not idempotent"}
        }else{
          if(!(Test-Path (Join-Path $caseRoot ".edupi-windows-upgrade-env.lock")) -or
            ($scenario -cne "false-restored" -and (Test-Path $resourceFile) -and
              (Get-Content -LiteralPath $resourceFile -Raw | ConvertFrom-Json).status -ceq "restored")){
            throw "incomplete recovery was marked restored"
          }
          if($scenario -cin @("remove-interrupted","save-interrupted","uninstall-fails","registration-remains","process-cleanup-fails","live-lease")){
            $script:profileLease.Dispose();$script:scenario="retry"
            Recover-ProfileEnvironment $caseRoot
            if((Test-Path $taskRoot) -or (Test-Path $canaryRoot) -or $script:registered){throw "interrupted recovery could not resume"}
          }
        }
        $script:profileLease.Dispose()
      }
    }finally{
      if($script:profileLease){$script:profileLease.Dispose()}
      [IO.Directory]::Delete($temp,$true)
    }
  `);
});

test("actual PowerShell persists directory intent before creation and preserves the last journal on a failed checkpoint", t => {
  powershellMocks(t, ["Save-ProfileJournal", "Start-ResourceJournal", "New-PrivateDirectory",
    "Remove-RecoveryDirectories", "Recover-ProfileEnvironment"], `
    $temp=[IO.Path]::Combine([IO.Path]::GetTempPath(),"windows-upgrade-intent-"+[guid]::NewGuid().ToString("N"))
    [void][IO.Directory]::CreateDirectory($temp)
    try{
      $env:USERPROFILE=$temp;$env:APPDATA=Join-Path $temp "appdata";$env:LOCALAPPDATA=Join-Path $temp "localappdata"
      $env:GITHUB_RUN_ID="123";$env:GITHUB_RUN_ATTEMPT="2";$env:WINDOWS_UPGRADE_DOWNLOAD_DIR=$temp
      $taskRoot=Join-Path $temp ("edupi-windows-upgrade-"+("a"*32))
      $canaryRoot=Join-Path $temp ("edupi-route1-canary-windows-upgrade-"+("a"*32))
      $destination=Join-Path $taskRoot "application"
      function Get-CurrentUserSid {return "synthetic"}
      function Assert-NoReparseAncestor {param($Path)}
      Start-ResourceJournal $temp
      $file=Join-Path $temp "resource-recovery.json"
      $script:creates=0
      function New-Item {param($ItemType,$Path)
        $script:creates++
        $read=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        if($Path -cnotin $read.directories){throw "directory intent was not persisted first"}
        throw "synthetic_directory_interruption"
      }
      $rejected=$false
      try{New-PrivateDirectory $taskRoot}catch{$rejected=$_.Exception.Message -ceq "synthetic_directory_interruption"}
      if(!$rejected -or (Test-Path $taskRoot) -or $script:creates -ne 1){throw "interruption was hidden"}
      function Save-ProfileJournal {param($Journal,$File) throw "synthetic_checkpoint_failure"}
      $rejected=$false
      try{New-PrivateDirectory $canaryRoot}catch{$rejected=$_.Exception.Message -ceq "synthetic_checkpoint_failure"}
      if(!$rejected -or (Test-Path $canaryRoot) -or $script:creates -ne 1){throw "created resources without a durable checkpoint"}
      $read=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
      if(@($read.directories).Count -ne 1 -or $read.directories[0] -cne $taskRoot){throw "last durable intent was lost"}
    }finally{
      if($script:profileLease){$script:profileLease.Dispose()}
      [IO.Directory]::Delete($temp,$true)
    }
  `);
});

test("actual PowerShell installation readback rejects remaining registration and unreadable registry keys", t => {
  powershellMocks(t, ["Assert-NoUpgradeInstallation"], `
    $script:registered=$false;$script:unreadable=$false
    function Test-Path {param($LiteralPath) return $LiteralPath.StartsWith("HK")}
    function Get-ChildItem {param($LiteralPath,$ErrorAction)
      if($ErrorAction -cne "Stop"){throw "registry errors were suppressed"}
      if($script:unreadable){throw "synthetic_registry_unreadable"}
      if($script:registered){return @{PSPath="synthetic-registration"}}
      return @()
    }
    function Get-ItemProperty {param($LiteralPath) return [pscustomobject]@{DisplayName="EduPi"}}
    Assert-NoUpgradeInstallation "synthetic_registration_remains"
    $script:registered=$true;$rejected=$false
    try{Assert-NoUpgradeInstallation "synthetic_registration_remains"}catch{$rejected=$_.Exception.Message -ceq "synthetic_registration_remains"}
    if(!$rejected){throw "remaining registration was green"}
    $script:registered=$false;$script:unreadable=$true;$rejected=$false
    try{Assert-NoUpgradeInstallation "synthetic_registration_remains"}catch{$rejected=$_.Exception.Message -ceq "synthetic_registry_unreadable"}
    if(!$rejected){throw "unreadable registration was green"}
  `);
});

test("cleanup entrypoint records blocked and retains downloads when resource recovery journal is missing or incomplete", t => {
  const executable = process.env.WINDOWS_UPGRADE_PWSH || "pwsh";
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "windows-upgrade-cleanup-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const download = path.join(root, "edupi-windows-upgrade-download-123-1");
  const evidence = path.join(root, "edupi-windows-upgrade-evidence-123-1");
  fs.mkdirSync(download);
  fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(download, ".windows-upgrade-owned"), OLD.sha256);
  fs.writeFileSync(path.join(download, "synthetic-retained.txt"), "synthetic recovery material");
  for (const state of ["missing", "incomplete"]) {
    if (state === "incomplete") {
      fs.writeFileSync(path.join(download, "resource-recovery.json"), JSON.stringify({ schemaVersion: 1 }));
    }
    // Both cases fail before SID, registry or process APIs. No installer/App exists.
    const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
      fileURLToPath(new URL("./test-windows-upgrade-acceptance.ps1", import.meta.url)), "-CleanupDownloadOnly"], {
      encoding: "utf8", timeout: 30_000, env: { ...process.env, RUNNER_TEMP: root,
        WINDOWS_UPGRADE_DOWNLOAD_DIR: download, WINDOWS_UPGRADE_EVIDENCE_DIR: evidence,
        GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" },
    });
    if (result.error?.code === "ENOENT") { t.skip("pwsh unavailable; cleanup entrypoint was not executed"); return; }
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const proof = JSON.parse(fs.readFileSync(path.join(evidence, "windows-upgrade-recovery.json"), "utf8").replace(/^\uFEFF/u, ""));
    assert.equal(proof.status, "blocked");
    assert.equal(proof.actualUpgradePassed, false);
    assert.equal(proof.code, `resource_recovery_journal_${state}`);
    assert.equal(fs.readFileSync(path.join(download, "synthetic-retained.txt"), "utf8"), "synthetic recovery material");
  }
});

test("actual PowerShell retires only retained drivers before fresh attach and cannot launch or stop the new App", t => {
  powershellMocks(t, ["Restart-AttachDriver"], `
    $tauriDriver="/private/tauri-driver.exe";$edgeDriver="/private/msedgedriver.exe";$appEnvironment=@{}
    $time=[datetime]::UtcNow
    $script:killed=[Collections.Generic.List[int]]::new();$script:started=[Collections.Generic.List[string]]::new()
    function Fake-Process($Id,$File){
      $p=[pscustomobject]@{Id=$Id;Path=$File;StartTime=$time;SafeHandle=1;HasExited=$false}
      $p | Add-Member ScriptMethod Kill { $script:killed.Add($this.Id);$this.HasExited=$true }
      $p | Add-Member ScriptMethod WaitForExit {param($Milliseconds) return $this.HasExited}
      return $p
    }
    $newApp=Fake-Process 300 "/private/application/pi-agent-desktop.exe"
    $script:ownedProcesses=@(
      @{process=(Fake-Process 200 $tauriDriver);file=$tauriDriver;started=$time},
      @{process=(Fake-Process 201 $edgeDriver);file=$edgeDriver;started=$time},
      @{process=$newApp;file=$newApp.Path;started=$time}
    )
    function Start-OwnedProcess {param($File,$Environment,$Arguments)
      if($File -cne $tauriDriver){throw "App launch attempted"}
      $script:started.Add($File);return @{HasExited=$false}
    }
    function Invoke-RestMethod {param($Uri,$TimeoutSec) return @{value=@{ready=$true}}}
    Restart-AttachDriver 4444 4445
    if(($script:killed.ToArray() -join ",") -cne "200,201" -or $newApp.HasExited -or $script:started.Count -ne 1){
      throw "driver retirement touched the automatically restarted App"
    }
    $script:ownedProcesses=@(@{process=(Fake-Process 202 $edgeDriver);file=$edgeDriver;started=$time.AddSeconds(-1)})
    $failed=$false;try{Restart-AttachDriver 4444 4445}catch{$failed=$true}
    if(!$failed -or $script:started.Count -ne 1 -or $script:killed.Count -ne 2){throw "driver PID identity mismatch was ignored"}
  `);
});

test("actual PowerShell captures a late orphan only inside the marked task TEMP with matching PID birth and path", t => {
  powershellMocks(t, ["Test-CimProcessIdentity", "Capture-PrivateTaskProcesses"], `
    $taskRoot=[IO.Path]::Combine([IO.Path]::GetTempPath(),"windows-upgrade-exclusive-synthetic")
    $time=[datetime]::new(2026,11,17,0,0,0,[DateTimeKind]::Utc)
    $private=[IO.Path]::Combine($taskRoot,"temp","installer.exe")
    $outside=[IO.Path]::Combine([IO.Path]::GetTempPath(),"unrelated.exe")
    $env:GITHUB_RUN_ID="123";$env:GITHUB_RUN_ATTEMPT="1";$script:marker="123-1"
    function Test-Path {param($LiteralPath) return $true}
    function Get-Content {param($LiteralPath,[switch]$Raw) return $script:marker}
    function Get-Item {param($LiteralPath) return @{CreationTimeUtc=$time}}
    function Assert-NoReparseAncestor {param($Path)}
    function Get-CimInstance {param($ClassName) return $script:rows}
    function Get-Process {param($Id,$ErrorAction) return $script:processes[[int]$Id]}
    $script:processes=@{
      1=@{Id=1;Path=$private;StartTime=$time.AddSeconds(1);SafeHandle=1;HasExited=$false}
      2=@{Id=2;Path=$outside;StartTime=$time.AddSeconds(1);SafeHandle=2;HasExited=$false}
      3=@{Id=3;Path=$private;StartTime=$time.AddSeconds(9);SafeHandle=3;HasExited=$false}
    }
    $script:rows=@(
      @{ProcessId=1;ParentProcessId=999;ExecutablePath=$private;CreationDate=$time.AddSeconds(1)},
      @{ProcessId=2;ParentProcessId=999;ExecutablePath=$outside;CreationDate=$time.AddSeconds(1)},
      @{ProcessId=3;ParentProcessId=999;ExecutablePath=$private;CreationDate=$time.AddSeconds(2)}
    )
    $script:ownedProcesses=[Collections.Generic.List[object]]::new()
    Capture-PrivateTaskProcesses;Capture-PrivateTaskProcesses
    if($script:ownedProcesses.Count -ne 1 -or $script:ownedProcesses[0].id -ne 1){throw "late orphan ownership was not constrained"}
    $script:marker="another-run"
    $failed=$false;try{Capture-PrivateTaskProcesses}catch{$failed=$true}
    if(!$failed){throw "unowned task directory used for process discovery"}
  `);
});
