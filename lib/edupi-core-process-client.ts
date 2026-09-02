import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export class EduPiCoreProcessError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EduPiCoreProcessError";
  }
}

function redactedDiagnostic(value: string): string {
  return value
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "[redacted]")
    .slice(0, 2000);
}

function allowedEnvironment(runtime: ResolvedEduPiCore, dataRoot: ResolvedEduPiDataRoot): NodeJS.ProcessEnv {
  const configuredStateDir = process.env.PI_DESKTOP_STATE_DIR?.trim();
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    TZ: process.env.TZ || "Asia/Shanghai",
    NODE_ENV: process.env.NODE_ENV || "production",
    EDUPI_PROJECT_ROOT: dataRoot.root,
    EDUPI_MEMORY_DIR: dataRoot.memoryDir,
    EDUPI_OUTPUT_DIR: dataRoot.outputDir,
    EDUPI_LOCK_DIR: dataRoot.lockDir,
    EDUPI_CORE_COMMIT: runtime.coreCommit,
    ...(configuredStateDir && isAbsolute(configuredStateDir) ? { PI_DESKTOP_STATE_DIR: resolve(configuredStateDir) } : {}),
  };
}

export function runCoreProcess<T = unknown>({
  runtime,
  dataRoot,
  request,
  timeoutMs,
  signal,
}: {
  runtime: ResolvedEduPiCore;
  dataRoot?: ResolvedEduPiDataRoot;
  request: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<T> {
  if (!dataRoot) return Promise.reject(new EduPiCoreProcessError("data_root", "Validated EduPi data root is required"));
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) return Promise.reject(new EduPiCoreProcessError("request_limit", "Core request exceeds limit"));
  if (signal?.aborted) return Promise.reject(new EduPiCoreProcessError("aborted", "Core request aborted"));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime.entrypoint], {
      cwd: runtime.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: allowedEnvironment(runtime, dataRoot),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!child.killed) child.kill("SIGKILL");
      reject(error);
    };
    const onAbort = () => finishError(new EduPiCoreProcessError("aborted", "Core request aborted"));
    const timer = setTimeout(() => finishError(new EduPiCoreProcessError("timeout", "Core request timeout")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) return finishError(new EduPiCoreProcessError("stdout_limit", "Core stdout limit exceeded"));
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) return finishError(new EduPiCoreProcessError("stderr_limit", "Core stderr limit exceeded"));
      stderr.push(chunk);
    });
    child.on("error", (error) => finishError(new EduPiCoreProcessError("spawn_error", error.message)));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const stderrText = redactedDiagnostic(Buffer.concat(stderr).toString("utf8"));
      if (code !== 0) return reject(new EduPiCoreProcessError("nonzero_exit", `Core process exit ${code}: ${stderrText}`));
      const text = Buffer.concat(stdout).toString("utf8").trim();
      const frames = text ? text.split("\n").filter((line) => line.trim()) : [];
      if (frames.length !== 1) return reject(new EduPiCoreProcessError("stdout_frames", "Core stdout must contain exactly one frame"));
      try { resolve(JSON.parse(frames[0]) as T); }
      catch { reject(new EduPiCoreProcessError("stdout_json", "Core stdout is not valid JSON")); }
    });
    child.stdin.end(input);
  });
}

export async function callEduPiCore<T = unknown>({
  operation,
  requestId,
  runtime,
  dataRoot,
  envelope,
  signal,
}: {
  operation: "health" | "snapshot" | "command" | "kernel" | "memory-scopes" | "teaching-skills" | "connectors" | "agent-computer" | "platform";
  requestId: string;
  runtime: ResolvedEduPiCore;
  dataRoot?: ResolvedEduPiDataRoot;
  envelope?: unknown;
  signal?: AbortSignal;
}): Promise<T> {
  const request = {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation,
    request_id: requestId,
    ...(envelope === undefined ? {} : { envelope }),
  };
  return runCoreProcess<T>({ runtime, dataRoot, request, timeoutMs: operation === "command" ? 15_000 : 5_000, signal });
}
