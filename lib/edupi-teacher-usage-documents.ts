import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { TeacherUsageError, usageExact, usageHash, type TeacherUsageDocuments } from "./edupi-teacher-usage-types.ts";

const MAX_DOCUMENT_BYTES = 128 * 1024;
export function teacherUsageDigest(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
export function teacherUsageCanonical(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (!item || typeof item !== "object") return item;
    const object = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, ordered(object[key])]));
  }
  return JSON.stringify(ordered(value));
}
function readRegular(file: string, max: number): Buffer {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== path.resolve(file)) throw new TeacherUsageError("usage_documents_invalid");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new TeacherUsageError("usage_documents_invalid");
    const bytes = fs.readFileSync(fd);
    if (bytes.length > max) throw new TeacherUsageError("usage_documents_invalid");
    return bytes;
  } finally { fs.closeSync(fd); }
}
/** Host configuration only. The registry and its exact UTF-8 document bytes are never supplied by the WebView. */
export function loadTeacherUsageDocuments(registryPath = process.env.EDUPI_USAGE_DOCUMENT_REGISTRY, includeText = false): TeacherUsageDocuments {
  if (!registryPath) return { configured: false, policy_ref: null };
  try {
    const registry: unknown = JSON.parse(readRegular(registryPath, 8192).toString("utf8"));
    if (!usageExact(registry, ["version", "privacy_policy", "user_agreement"]) || registry.version !== 1) throw new Error("registry");
    const documents = {} as Pick<TeacherUsageDocuments, "privacy_policy" | "user_agreement">;
    for (const kind of ["privacy_policy", "user_agreement"] as const) {
      const item = registry[kind];
      if (!usageExact(item, ["version", "sha256", "file"]) || typeof item.version !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(item.version) || !usageHash(item.sha256) || typeof item.file !== "string") throw new Error("document");
      const bytes = readRegular(item.file, MAX_DOCUMENT_BYTES);
      const text = bytes.toString("utf8");
      if (!text.trim() || !Buffer.from(text, "utf8").equals(bytes) || teacherUsageDigest(bytes) !== item.sha256 || text.includes("\0")) throw new Error("digest");
      documents[kind] = { version: item.version, sha256: item.sha256, ...(includeText ? { text } : {}) };
    }
    const policyRef = teacherUsageDigest(teacherUsageCanonical(Object.fromEntries(Object.entries(documents).map(([kind, item]) => [kind, { version: item?.version, sha256: item?.sha256 }]))));
    return { configured: true, policy_ref: policyRef, ...documents };
  } catch { throw new TeacherUsageError("usage_documents_invalid"); }
}
