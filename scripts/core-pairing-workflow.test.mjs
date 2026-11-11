import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/core-pairing-checks.yml", import.meta.url), "utf8");
const block = workflow.split("python3 - <<'PY'\n")[1].split("\n          PY")[0];
const indent = Math.min(...block.split("\n").filter(line => line.trim()).map(line => line.match(/^ */)[0].length));
const guard = block.split("\n").map(line => line.slice(indent)).join("\n");

function check(overrides) {
  return spawnSync("python3", ["-c", guard], { encoding: "utf8", env: {
    PATH: process.env.PATH, EVENT: "pull_request", DRAFT: "false",
    HEAD_REPOSITORY: "owner/desktop", REPOSITORY: "owner/desktop",
    REF: "refs/pull/1/merge", ...overrides,
  } });
}

test("private runtime checkout is gated before any candidate or secret checkout", () => {
  assert.ok(workflow.indexOf("Require ready internal source") < workflow.indexOf("uses: actions/checkout@"));
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /^\s+paths:/m);
  assert.match(workflow, /persist-credentials: false/);
});

test("draft and fork candidates cannot reach private runtime access", () => {
  assert.notEqual(check({ DRAFT: "true" }).status, 0);
  assert.notEqual(check({ HEAD_REPOSITORY: "fork/desktop" }).status, 0);
  assert.equal(check({}).status, 0);
});

test("manual checks cannot use tools from a non-main branch", () => {
  assert.notEqual(check({ EVENT: "workflow_dispatch", REF: "refs/heads/candidate" }).status, 0);
  assert.equal(check({ EVENT: "workflow_dispatch", REF: "refs/heads/main" }).status, 0);
});

test("merge groups cannot bypass fork provenance checks for private runtime access", () => {
  assert.notEqual(check({ EVENT: "merge_group", HEAD_REPOSITORY: "fork/desktop" }).status, 0);
  assert.notEqual(check({ EVENT: "merge_group" }).status, 0);
});
