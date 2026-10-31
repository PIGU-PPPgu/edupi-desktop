#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const APP = "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop";
const CORE_HOST = "/Applications/EduPi.app/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node /Applications/EduPi.app/Contents/Resources/resources/server/core-runtime-host.mjs";

function envValue(raw, name) {
  const matches = [...raw.matchAll(new RegExp(`(?:^|\\s)${name}=([^\\s]*)`, "gu"))];
  return matches.length === 1 ? matches[0][1] : null;
}

/** Fail before CUA can bind to (and potentially relaunch) a different App. */
export function assertIsolatedProcessEvidence({ root, realRoot, processes, home = os.homedir() }) {
  assert.ok(path.isAbsolute(root) && !/\s/u.test(root) && root.startsWith(`${home}${path.sep}`)
    && /^edupi-route1-canary-[a-z0-9-]{1,80}$/u.test(path.basename(root))
    && root !== realRoot && !root.startsWith(`${realRoot}${path.sep}`),
    "isolated root is invalid or overlaps the real teacher root");
  assert.ok(Array.isArray(processes) && processes.length === 2, "expected exactly one App and one Core host");
  const app = processes.find(item => item.command === APP);
  const host = processes.find(item => item.command === CORE_HOST);
  assert.ok(app && host && app !== host, "unexpected EduPi process set");
  assert.ok(Number.isSafeInteger(app.pid) && app.pid > 0 && Number.isSafeInteger(host.pid) && host.pid > 0,
    "invalid EduPi process identity");
  for (const [name, expected] of Object.entries({
    EDUPI_DATA_ROOT: root, EDUPI_PROJECT_ROOT: root, EDUPI_ROUTE1_ISOLATED_CANARY: "1",
  })) if (envValue(app.environment, name) !== expected) throw new Error(`App ${name} is not isolated`);
  for (const [name, expected] of Object.entries({
    EDUPI_PROJECT_ROOT: root, EDUPI_HOME: path.join(root, ".edupi"),
    EDUPI_MEMORY_DIR: path.join(root, ".edupi/memory"),
    EDUPI_OUTPUT_DIR: path.join(root, ".edupi/output"),
    EDUPI_LOCK_DIR: path.join(root, ".edupi/locks"),
    EDUPI_DESKTOP_ISOLATED_CANARY: "1",
  })) if (envValue(host.environment, name) !== expected) throw new Error(`Core host ${name} is not isolated`);
  return { status: "isolated", appPid: app.pid, coreHostPid: host.pid,
    rootSha256: createHash("sha256").update(root).digest("hex") };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 128_000 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} could not inspect EduPi processes`);
  return result.stdout;
}

function runningProcesses(includeEnvironment = true) {
  const result = spawnSync("/usr/bin/pgrep", ["-fl", "^/Applications/EduPi\\.app/"],
    { encoding: "utf8", maxBuffer: 128_000 });
  if (result.error || result.status !== 0 && result.status !== 1)
    throw new Error("pgrep could not inspect EduPi processes");
  if (result.status === 1) return [];
  return result.stdout.trim().split("\n").map(line => {
    const match = /^(\d+) (.+)$/u.exec(line);
    if (!match) throw new Error("unrecognized EduPi process identity");
    const pid = Number(match[1]);
    return { pid, command: match[2], environment: includeEnvironment
      ? run("/bin/ps", ["eww", "-p", String(pid), "-o", "command="]) : "" };
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.platform !== "darwin") throw new Error("macOS only");
    const mode = process.argv[2];
    if (mode === "stopped" && process.argv.length === 3) {
      assert.equal(runningProcesses(false).length, 0, "EduPi or a helper is still running");
      console.log(JSON.stringify({ status: "stopped", appAndHelpers: 0 }));
    } else if (mode === "before-cua" && process.argv.length === 4) {
      const root = realpathSync(process.argv[3]);
      assert.equal(root, process.argv[3], "isolated root must be canonical");
      const prefs = JSON.parse(readFileSync(path.join(os.homedir(),
        "Library/Application Support/com.abcwyc.pi-agent/ui-prefs.json"), "utf8"));
      const realRoot = realpathSync(prefs.edupiDataRoot);
      console.log(JSON.stringify(assertIsolatedProcessEvidence({ root, realRoot, processes: runningProcesses() })));
    } else throw new Error("usage: before-cua <canonical synthetic root> | stopped");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "isolated process verification failed");
    process.exitCode = 1;
  }
}
