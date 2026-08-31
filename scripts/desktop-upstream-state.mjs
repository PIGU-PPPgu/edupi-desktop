import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DESKTOP_UPSTREAM_REPOSITORY = "abcwyc/pi-agent-desktop";
export const DESKTOP_UPSTREAM_BRANCH = "main";
export const statePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "desktop-upstream-state.json",
);

const commitPattern = /^[0-9a-f]{40}$/;

export function parseDesktopUpstreamState(source) {
  const state = JSON.parse(source);
  if (
    state.schemaVersion !== 1 ||
    state.repository !== DESKTOP_UPSTREAM_REPOSITORY ||
    state.branch !== DESKTOP_UPSTREAM_BRANCH ||
    (state.reviewedCommit !== null && !commitPattern.test(state.reviewedCommit))
  ) {
    throw new Error("Invalid desktop upstream review state");
  }
  return state;
}

export async function readDesktopUpstreamState() {
  return parseDesktopUpstreamState(await readFile(statePath, "utf8"));
}

export async function recordReviewedCommit(commit) {
  if (!commitPattern.test(commit)) throw new Error("Reviewed upstream commit must be a full SHA");
  const state = await readDesktopUpstreamState();
  await writeFile(statePath, `${JSON.stringify({ ...state, reviewedCommit: commit }, null, 2)}\n`);
}

export async function main([command, argument] = process.argv.slice(2)) {
  if (command === "get" && argument === undefined) {
    console.log((await readDesktopUpstreamState()).reviewedCommit ?? "");
    return;
  }
  if (command === "set" && argument !== undefined) {
    await recordReviewedCommit(argument);
    return;
  }
  throw new Error("Usage: desktop-upstream-state.mjs get | set <40-character-sha>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
