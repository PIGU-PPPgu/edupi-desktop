import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "scripts", "test-windows-installed-release.ps1"), "utf8");
const workflow = await readFile(join(root, ".github", "workflows", "windows-build-debug.yml"), "utf8");
const canary = await readFile(join(root, "scripts", "test-windows-route1-preview.ps1"), "utf8");

test("published Windows install reuses an installer-started process and captures bounded crash evidence", () => {
  assert.match(source, /Get-Process -Name "pi-agent-desktop"/);
  assert.match(source, /Installer started the application/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /RedirectStandardError/);
  assert.match(source, /Write-LaunchDiagnostics/);
  assert.match(source, /Get-WinEvent -FilterHashtable/);
  assert.match(source, /Get-Content \$Path -Tail 120/);
  assert.match(source, /\[redacted\]/);
  assert.doesNotMatch(source, /Get-Content \$Path -Raw/);
});

test("published Windows smoke keeps native Core admission closed and checks the exact public installer", () => {
  assert.match(source, /\$release\.draft -or \$release\.prerelease/u);
  assert.match(source, /Get-FileHash \$installer -Algorithm SHA256/u);
  assert.match(source, /\$assets\[0\]\.digest/u);
  assert.match(source, /api\/desktop\/identity/u);
  assert.match(source, /api\/home/u);
  assert.doesNotMatch(source, /^\s*\$home\s*=/imu);
  assert.doesNotMatch(source, /Invoke-WebRequest[^\n]*api\/edupi\/workspace/u);
  assert.match(source, /EDUPI_PREVIEW_INSTALLED_DIR = \$destination/u);
  assert.match(source, /EDUPI_PREVIEW_COMPAT_PATH = \$compatPath/u);
  assert.match(source, /\$sourceCommit -ne \$release\.target_commitish/u);
  assert.match(canary, /EDUPI_PREVIEW_COMPAT_PATH/u);
  assert.match(canary, /if \(\$reuseInstalled\) \{/u);
  assert.match(canary, /if \(!\$reuseInstalled\) \{\s*\$installation = Start-Process/u);
  assert.match(canary, /\} else \{\s*\$second = Start-Process/u);
  assert.match(canary, /The public-install wrapper already checked a second launch/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.tag \}\}/u);
  assert.match(workflow, /timeout-minutes: 15/u);
  assert.match(workflow, /Join-Path \$publishedSource "src-tauri\/Cargo\.toml"/u);
  assert.match(source, /test-windows-route1-preview\.ps1/u);
  assert.ok(source.indexOf("test-windows-route1-preview.ps1") > source.indexOf("System32/taskkill.exe"),
    "the normal-mode process must stop before the isolated Safe Mode canary");
});
