import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

export async function validateMacOSStaple(target, {
  run = spawnSync, wait = setTimeout, log = text => process.stderr.write(text),
} = {}) {
  if (!target) throw new Error("A signed application or disk image path is required");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run("xcrun", ["stapler", "validate", target], { encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    log(output);
    if (result.status === 0) return;
    // Only retry observed CloudKit transport errors; ticket/signature failures
    // and errors from other endpoints must fail immediately.
    const transientCloudKitError = result.status === 68 && (
      /NSURLErrorDomain Code=-1009\b/.test(output) ||
      (/NSURLErrorDomain Code=-1005\b/.test(output) &&
        /https:\/\/api\.apple-cloudkit\.com\/database\/1\/com\.apple\.gk\.ticket-delivery\//.test(output))
    );
    if (attempt === 3 || !transientCloudKitError) {
      throw new Error(`Staple validation failed with status ${result.status ?? "unavailable"}`);
    }
    log(`CloudKit connection interrupted; retrying staple validation (${attempt}/3).\n`);
    await wait(5_000);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateMacOSStaple(process.argv[2]);
}
