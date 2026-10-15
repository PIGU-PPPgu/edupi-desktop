import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const submissionIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const appleStatusRoute = /https:\/\/appstoreconnect\.apple\.com\/notary\/v2\/submissions\//;
const transportError = /NSURLErrorDomain Code=-(?:1005|1009)\b/;

function safeDiagnostic(result, credentials) {
  const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
  let redacted = output;
  for (const value of [credentials.appleId, credentials.password, credentials.teamId]) {
    if (value) redacted = redacted.replaceAll(value, "[redacted]");
  }
  const network = output.match(/NSURLErrorDomain Code=(-?\d{1,6})\b/)?.[1] ?? "none";
  const http = output.match(/statusCode:\s*(\d{3})\b/)?.[1] ?? "none";
  const host = /https:\/\/appstoreconnect\.apple\.com\/notary\/v2\//.test(output)
    ? "appstoreconnect.apple.com" : "other";
  const processCode = result?.error?.code === "ETIMEDOUT" ? "ETIMEDOUT" : "none";
  const digest = createHash("sha256").update(redacted).digest("hex").slice(0, 12);
  return `exit=${result?.status ?? "none"} network=${network} http=${http} host=${host} process=${processCode} diagnostic_sha256=${digest}`;
}

function parsedResult(result, label, credentials) {
  try {
    return JSON.parse(result.stdout ?? "");
  } catch {
    throw new Error(`Apple notary ${label} returned invalid JSON: ${safeDiagnostic(result, credentials)}`);
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
  if (submitted?.status !== 0) {
    throw new Error(`Apple notary submission failed; no retry without an ID: ${safeDiagnostic(submitted, credentials)}`);
  }
  const submissionId = parsedResult(submitted, "submission", credentials).id;
  if (!submissionIdPattern.test(submissionId)) throw new Error("Apple notary submission ID is invalid");
  log(`Apple notary submission ${submissionId} uploaded`);

  let lastFailure = null;
  for (let poll = 1; poll <= maxPolls; poll++) {
    const result = run("xcrun", ["notarytool", "info", submissionId, ...auth], {
      encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000,
    });
    if (result?.status === 0) {
      const info = parsedResult(result, "status", credentials);
      if (info.id !== submissionId) throw new Error("Apple notary submission identity mismatch");
      if (info.status === "Accepted") {
        log(`Apple notary submission ${submissionId}: Accepted`);
        return submissionId;
      }
      if (info.status !== "In Progress") {
        throw new Error(`Apple notary submission ${submissionId}: ${info.status === "Invalid" ? "Invalid" : "unknown status"}`);
      }
      lastFailure = null;
    } else {
      const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
      const timedOut = result?.error?.code === "ETIMEDOUT";
      if (!timedOut && (!transportError.test(output) || !appleStatusRoute.test(output))) {
        throw new Error(`Apple notary status failed for ${submissionId}: ${safeDiagnostic(result, credentials)}`);
      }
      lastFailure = safeDiagnostic(result, credentials);
    }
    if (poll === maxPolls) break;
    await wait(15_000);
  }
  if (lastFailure) {
    throw new Error(`Apple notary status unavailable after ${maxPolls} polls for ${submissionId}: ${lastFailure}`);
  }
  throw new Error(`Apple notary status pending after ${maxPolls} polls for ${submissionId}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await notarizeMacOSDmg(process.argv[2]);
}
