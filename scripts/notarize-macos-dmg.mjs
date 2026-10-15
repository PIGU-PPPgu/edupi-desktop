import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const submissionIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const appleStatusRoute = /https:\/\/appstoreconnect\.apple\.com\/notary\/v2\/submissions\//;
const transportError = /NSURLErrorDomain Code=-(?:1005|1009)\b/;

function parsedResult(result, label) {
  try {
    return JSON.parse(result.stdout ?? "");
  } catch {
    throw new Error(`Apple notary ${label} returned invalid JSON`);
  }
}

export async function notarizeMacOSDmg(target, {
  credentials = {
    appleId: process.env.NOTARY_APPLE_ID,
    password: process.env.NOTARY_PASSWORD,
    teamId: process.env.NOTARY_TEAM_ID,
  },
  run = spawnSync,
  wait = setTimeout,
  log = message => process.stdout.write(`${message}\n`),
  maxPolls = 80,
} = {}) {
  if (!target || !credentials.appleId || !credentials.password || !credentials.teamId) {
    throw new Error("DMG path and Apple notary credentials are required");
  }
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 80) {
    throw new Error("Notary poll limit is invalid");
  }
  const auth = ["--apple-id", credentials.appleId, "--password", credentials.password,
    "--team-id", credentials.teamId, "--output-format", "json"];
  const submitted = run("xcrun", ["notarytool", "submit", target, "--no-wait", ...auth], {
    encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10 * 60_000,
  });
  if (submitted?.status !== 0) throw new Error("Apple notary submission failed; no retry without an ID");
  const submissionId = parsedResult(submitted, "submission").id;
  if (!submissionIdPattern.test(submissionId)) throw new Error("Apple notary submission ID is invalid");
  log(`Apple notary submission ${submissionId} uploaded`);

  for (let poll = 1; poll <= maxPolls; poll++) {
    const result = run("xcrun", ["notarytool", "info", submissionId, ...auth], {
      encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000,
    });
    if (result?.status === 0) {
      const info = parsedResult(result, "status");
      if (info.id !== submissionId) throw new Error("Apple notary submission identity mismatch");
      if (info.status === "Accepted") {
        log(`Apple notary submission ${submissionId}: Accepted`);
        return submissionId;
      }
      if (info.status !== "In Progress") {
        throw new Error(`Apple notary submission ${submissionId}: ${info.status === "Invalid" ? "Invalid" : "unknown status"}`);
      }
    } else {
      const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
      const timedOut = result?.error?.code === "ETIMEDOUT";
      if (!timedOut && (!transportError.test(output) || !appleStatusRoute.test(output))) {
        throw new Error(`Apple notary status failed for ${submissionId}`);
      }
    }
    if (poll === maxPolls) break;
    await wait(15_000);
  }
  throw new Error(`Apple notary status unavailable after ${maxPolls} polls for ${submissionId}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await notarizeMacOSDmg(process.argv[2]);
}
