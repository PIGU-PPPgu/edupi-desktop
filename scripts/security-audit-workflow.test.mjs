import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("dependency security is checked on PRs, main, and a daily schedule", async () => {
  const [packageJson, workflow] = await Promise.all([
    read("package.json"),
    read(".github/workflows/security-audit.yml"),
  ]);
  assert.equal(JSON.parse(packageJson).scripts["security:audit"], "npm audit --audit-level=high");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /cron: "17 3 \* \* \*"/);
  assert.match(workflow, /run: npm run security:audit/);
  assert.match(workflow, /npm ci\s+npm ls fast-glob undici brace-expansion --all\s+node --test scripts\/dependency-security\.test\.mjs/);
  assert.match(workflow, /if: github\.event_name != 'schedule'/);
  assert.match(workflow, /npm test\s+PI_WEB_DESKTOP_BUILD=1 npx next typegen --webpack\s+node_modules\/\.bin\/tsc --noEmit\s+npm run lint/);
  assert.match(workflow, /run: cargo install cargo-audit --locked/);
  assert.match(workflow, /run: cargo audit --file src-tauri\/Cargo\.lock --deny warnings/);
  assert.doesNotMatch(workflow, /--(?:ignore|no-yanked|target-os|target-arch|stale)\b/);
  assert.doesNotMatch(workflow, /rustsec\/audit-check/);
});

test("Linux compatibility checks compile source without a Windows runner or packaging", async () => {
  const workflow = await read(".github/workflows/security-audit.yml");
  const linux = workflow.slice(workflow.indexOf("  linux-source:"));
  assert.match(linux, /runs-on: ubuntu-latest/);
  assert.match(linux, /toolchain: 1\.92\.0/);
  assert.match(linux, /cargo check --locked --all-targets/);
  assert.match(linux, /main_context_channel::tests/);
  assert.match(linux, /dbus-run-session -- env EDUPI_TEST_DBUS_ISOLATED=1/);
  assert.doesNotMatch(linux, /windows-latest|tauri build|next build|cargo install|rm -|cargo clean/);
});

test("Dependabot opens grouped security updates without routine version noise", async () => {
  const config = await read(".github/dependabot.yml");
  assert.match(config, /package-ecosystem: "npm"/);
  assert.match(config, /open-pull-requests-limit: 0/);
  assert.match(config, /applies-to: security-updates/);
  assert.match(config, /patterns:\s*\n\s*- "\*"/);
  assert.match(config, /package-ecosystem: "cargo"/);
  assert.match(config, /rust-security:/);
});
