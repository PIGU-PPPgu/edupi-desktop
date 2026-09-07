import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";
import { getEduPiCoreRendezvous, type EduPiCoreRendezvous } from "./edupi-core-rendezvous";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_OUTER_REQUEST_BYTES = 589_824;
const MAX_OUTER_RESPONSE_BYTES = 4_259_840;
const CORE_RUNTIME_PROTOCOL = "edupi-core-runtime";
const CORE_RUNTIME_PROTOCOL_VERSION = 1;
const CORE_RUNTIME_BRIDGE_CONTRACT_VERSION = "1.1";
export const EDUPI_CORE_CLIENT_READ_TIMEOUT_MS = 7_000;
export const EDUPI_CORE_CLIENT_MUTATION_TIMEOUT_MS = 17_000;

export class EduPiCoreProcessError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "EduPiCoreProcessError";
  }
}

function bridgeIdentity(operation: string, requestId: string, envelope?: unknown): Record<string, unknown> {
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation,
    request_id: requestId,
    ...(envelope === undefined ? {} : { envelope }),
  };
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new EduPiCoreProcessError("response_limit", "Core response exceeds limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function runtimeError(code: unknown): EduPiCoreProcessError {
  const safe = typeof code === "string" && /^[a-z][a-z0-9_]{1,63}$/u.test(code) ? code : "runtime_error";
  return new EduPiCoreProcessError(safe, "Core runtime request failed");
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

async function callBrokerRequest<T>({
  rendezvous,
  runtime,
  request,
  timeoutMs,
  signal,
}: {
  rendezvous: EduPiCoreRendezvous;
  runtime: ResolvedEduPiCore;
  request: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<T> {
  if (!rendezvous.endpoint || !rendezvous.capability_token || !rendezvous.supervisor_session_id) {
    throw new EduPiCoreProcessError("supervisor_unavailable", "Core supervisor is unavailable");
  }
  if (runtime.coreCommit !== rendezvous.core_commit || runtime.componentManifestHash !== rendezvous.component_manifest_hash) {
    throw new EduPiCoreProcessError("runtime_identity", "Core runtime pin does not match the attested rendezvous");
  }
  const operation = request.operation;
  const requestId = request.request_id;
  if (typeof operation !== "string" || typeof requestId !== "string") throw new EduPiCoreProcessError("invalid_request", "Core bridge request identity is invalid");
  const outerOperation = ["command", "students", "delete"].includes(operation) ? "bridge_call" : "bridge_read";
  if (outerOperation === "bridge_read" && !["health", "snapshot"].includes(operation)) throw new EduPiCoreProcessError("unsupported_operation", "Core operation is unavailable");
  const runtimeRequest = {
    protocol: CORE_RUNTIME_PROTOCOL,
    protocol_version: CORE_RUNTIME_PROTOCOL_VERSION,
    schema_hash: rendezvous.schema_hash,
    request_id: requestId,
    operation: outerOperation,
    payload: { bridge_frame: JSON.stringify(request) },
  };
  const body = JSON.stringify(runtimeRequest);
  if (Buffer.byteLength(body, "utf8") > MAX_OUTER_REQUEST_BYTES) throw new EduPiCoreProcessError("request_limit", "Core request exceeds limit");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(rendezvous.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rendezvous.capability_token}`,
          host: new URL(rendezvous.endpoint).host,
        },
        body,
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new EduPiCoreProcessError(signal?.aborted ? "aborted" : "timeout", "Core runtime request aborted");
      throw new EduPiCoreProcessError("supervisor_unavailable", "Core supervisor is unavailable");
    }
    if ((response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new EduPiCoreProcessError("runtime_identity", "Core broker response type is invalid");
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && !/^\d+$/u.test(contentLength)) throw new EduPiCoreProcessError("content_length", "Core runtime content length is invalid");
    if (contentLength !== null && Number(contentLength) > MAX_OUTER_RESPONSE_BYTES) throw new EduPiCoreProcessError("response_limit", "Core response exceeds limit");
    let text: string;
    try { text = await readResponseBytes(response, MAX_OUTER_RESPONSE_BYTES); }
    catch (error) {
      if (error instanceof EduPiCoreProcessError) throw error;
      throw new EduPiCoreProcessError("runtime_utf8", "Core runtime response encoding is invalid");
    }
    if (contentLength !== null && Buffer.byteLength(text, "utf8") !== Number(contentLength)) throw new EduPiCoreProcessError("content_length", "Core runtime content length is inconsistent");
    if (!response.ok) throw runtimeError((() => { try { return JSON.parse(text).error_code; } catch { return "supervisor_unavailable"; } })());
    let outer: Record<string, unknown>;
    try { outer = JSON.parse(text); } catch { throw new EduPiCoreProcessError("runtime_json", "Core runtime response is not valid JSON"); }
    if (!outer || typeof outer !== "object" || !hasExactKeys(outer, ["error_code", "external_send", "ok", "operation", "protocol", "protocol_version", "request_id", "result", "schema_hash"]) || outer.protocol !== CORE_RUNTIME_PROTOCOL || outer.protocol_version !== 1
      || outer.schema_hash !== rendezvous.schema_hash || outer.request_id !== requestId || outer.operation !== outerOperation
      || outer.external_send !== false) throw new EduPiCoreProcessError("runtime_identity", "Core runtime response identity is invalid");
    if (outer.ok !== true) throw runtimeError(outer.error_code);
    if (outer.error_code !== null) throw new EduPiCoreProcessError("runtime_identity", "Core runtime success error field is invalid");
    const result = outer.result as Record<string, unknown> | null;
    if (!result || typeof result !== "object" || !hasExactKeys(result, ["bridge_contract_version", "bridge_frame"]) || result.bridge_contract_version !== CORE_RUNTIME_BRIDGE_CONTRACT_VERSION || typeof result.bridge_frame !== "string" || !result.bridge_frame.endsWith("\n")) {
      throw new EduPiCoreProcessError("bridge_response", "Core bridge response is invalid");
    }
    const frame = result.bridge_frame;
    if (frame.indexOf("\n") !== frame.length - 1 || frame.slice(0, -1).includes("\n")) throw new EduPiCoreProcessError("bridge_response", "Core bridge response contains multiple frames");
    try { return JSON.parse(frame.slice(0, -1)) as T; } catch { throw new EduPiCoreProcessError("bridge_response", "Core bridge response is not valid JSON"); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
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
  const rendezvous = getEduPiCoreRendezvous();
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) return Promise.reject(new EduPiCoreProcessError("request_limit", "Core request exceeds limit"));
  if (signal?.aborted) return Promise.reject(new EduPiCoreProcessError("aborted", "Core request aborted"));
  if (!rendezvous) return Promise.reject(new EduPiCoreProcessError("supervisor_unavailable", "Core supervisor is unavailable"));
  if (!request || typeof request !== "object" || Array.isArray(request)) return Promise.reject(new EduPiCoreProcessError("invalid_request", "Core bridge request is invalid"));
  return callBrokerRequest<T>({ rendezvous, runtime, request: request as Record<string, unknown>, timeoutMs, signal });
}

export async function callEduPiCore<T = unknown>({
  operation,
  requestId,
  runtime,
  dataRoot,
  envelope,
  signal,
}: {
  operation: "health" | "snapshot" | "command" | "kernel" | "memory-scopes" | "teaching-skills" | "connectors" | "agent-computer" | "platform" | "connector-setup";
  requestId: string;
  runtime: ResolvedEduPiCore;
  dataRoot?: ResolvedEduPiDataRoot;
  envelope?: unknown;
  signal?: AbortSignal;
}): Promise<T> {
  const timeoutMs = operation === "command" ? EDUPI_CORE_CLIENT_MUTATION_TIMEOUT_MS : EDUPI_CORE_CLIENT_READ_TIMEOUT_MS;
  const request = bridgeIdentity(operation, requestId, envelope);
  return runCoreProcess<T>({ runtime, dataRoot, request, timeoutMs, signal });
}
