import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const SERVICE = "com.abcwyc.pi-agent.openconnector.github.runtime";
const ACCOUNT = "runtime-encryption-v1";
type SecurityResult = { code: number; stdout: string };
export type SecurityRunner = (args: string[], input?: string) => Promise<SecurityResult>;

function unavailable(): never { throw new Error("github_keychain_unavailable"); }

/** No credential is passed in argv, environment, or an intermediate file. */
export const runDesktopSecurity: SecurityRunner = async (args, input) => {
  const child = spawn("/usr/bin/security", args, {
    stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "production", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  child.stdin.on("error", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<SecurityResult>((resolve, reject) => {
      const parts: Buffer[] = [];
      let bytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8192) { child.kill("SIGKILL"); reject(new Error("github_keychain_unavailable")); }
        else parts.push(chunk);
      });
      child.stderr.on("data", () => {});
      child.once("error", () => reject(new Error("github_keychain_unavailable")));
      child.once("close", (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(parts).toString("utf8") }));
      timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("github_keychain_unavailable")); }, 15_000);
      child.stdin.end(input);
    });
  } finally { if (timer) clearTimeout(timer); }
};

export async function loadOrCreateGitHubRuntimeKey({ databaseExists = false, run = runDesktopSecurity }: {
  databaseExists?: boolean;
  run?: SecurityRunner;
} = {}): Promise<string> {
  const args = ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"];
  let value;
  try { value = await run(args); } catch { unavailable(); }
  if (value.code === 0) {
    const key = value.stdout.trim();
    if (!/^[a-f0-9]{64}$/u.test(key)) unavailable();
    return key;
  }
  if (value.code !== 44 || databaseExists) unavailable();
  const key = randomBytes(32).toString("hex");
  try {
    // The fixed command and hex-only key go through the private pipe. `-A`
    // and permission-list changes are deliberately absent.
    const result = await run(["-i", "-q"], `add-generic-password -a ${ACCOUNT} -s ${SERVICE} -w ${key}\n`);
    if (result.code !== 0) unavailable();
    const stored = await run(args);
    if (stored.code !== 0 || stored.stdout.trim() !== key) unavailable();
  } catch { unavailable(); }
  return key;
}
