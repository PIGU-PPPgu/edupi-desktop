import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

async function runMacOSStapler(target, operation, {
  run = spawnSync, wait = setTimeout, log = text => process.stderr.write(text),
} = {}) {
  if (!target) throw new Error("A signed application or disk image path is required");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run("xcrun", ["stapler", operation, target], { encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    log(output);
    if (result.status === 0) return;
    // Only retry observed CloudKit transport errors; ticket/signature failures
    // and errors from other endpoints must fail immediately.
    const urls = output.match(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"',)}]+/gu) ?? [];
    const ticketEndpointOnly = urls.length > 0 && urls.every(url =>
      url.startsWith("https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/"));
    // Retain the original URL-less offline validation diagnostic, but never
    // treat an explicitly different endpoint as a ticket-delivery failure.
    const legacyOfflineValidation = operation === "validate" && urls.length === 0
      && /NSURLErrorDomain Code=-1009\b/.test(output);
    const transientCloudKitError = result.status === 68 && (legacyOfflineValidation ||
      (ticketEndpointOnly && /NSURLErrorDomain Code=-100[59]\b/.test(output)));
    if (attempt === 3 || !transientCloudKitError) {
      const label = operation === "validate" ? "Staple validation" : "Ticket stapling";
      throw new Error(`${label} failed with status ${result.status ?? "unavailable"}`);
    }
    log(`CloudKit connection interrupted; retrying ${operation} (${attempt}/3).\n`);
    await wait(5_000);
  }
}

export function validateMacOSStaple(target, options) {
  return runMacOSStapler(target, "validate", options);
}

export function stapleMacOSArtifact(target, options) {
  return runMacOSStapler(target, "staple", options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateMacOSStaple(process.argv[2]);
}
