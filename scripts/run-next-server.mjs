import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const [command, exposure] = process.argv.slice(2);
if (!["dev", "start"].includes(command) || !["local", "lan"].includes(exposure)) {
  process.stderr.write("Usage: run-next-server.mjs <dev|start> <local|lan>\n");
  process.exitCode = 2;
} else {
  const require = createRequire(import.meta.url);
  const host = exposure === "local" ? "127.0.0.1" : "0.0.0.0";
  const environment = { ...process.env };
  if (exposure === "local") environment.PI_WEB_PRIVATE_MODEL_LOCAL = "1";
  else delete environment.PI_WEB_PRIVATE_MODEL_LOCAL;
  const args = [require.resolve("next/dist/bin/next"), command,
    ...(command === "dev" ? ["--webpack"] : []), "-H", host, "-p", "30141"];
  const child = spawn(process.execPath, args, { stdio: "inherit", env: environment });
  child.on("error", (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
