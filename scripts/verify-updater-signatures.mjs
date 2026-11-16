import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

function decodeBase64(value, label) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`Invalid ${label} Base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`Invalid ${label} Base64`);
  return decoded;
}

function envelope(value, lineCount, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(value.trim(), label));
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length !== lineCount || !lines[0].startsWith("untrusted comment: ")) {
    throw new Error(`Invalid ${label} envelope`);
  }
  return lines;
}

function assertVersion(version) {
  if (typeof version !== "string" || !/^[0-9A-Za-z.+-]{1,64}$/.test(version)) {
    throw new Error("Release version is required");
  }
}

// Minisign's payload signature is 2 algorithm bytes, 8 key ID bytes and 64 Ed25519
// bytes. Its global signature covers those last 64 bytes plus the trusted comment.
// This matches minisign-verify 0.3.0 used by the native updater.
export async function verifyUpdaterSignature({ artifactPath, publicKey, version }) {
  assertVersion(version);
  const keyLines = envelope(publicKey, 2, "public key");
  const key = decodeBase64(keyLines[1], "public key");
  const lines = envelope(await readFile(`${artifactPath}.sig`, "utf8"), 4, "signature");
  const signature = decodeBase64(lines[1], "signature");
  const globalSignature = decodeBase64(lines[3], "global signature");
  const algorithm = signature.subarray(0, 2).toString("utf8");
  if (
    key.length !== 42 || !["Ed", "ED"].includes(key.subarray(0, 2).toString("utf8")) ||
    signature.length !== 74 || !["Ed", "ED"].includes(algorithm) || globalSignature.length !== 64 ||
    !lines[2].startsWith("trusted comment: ")
  ) {
    throw new Error("Invalid Minisign signature or public key");
  }
  if (!key.subarray(2, 10).equals(signature.subarray(2, 10))) {
    throw new Error("Updater signature key ID does not match the public key");
  }
  const ed25519Key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const payloadSignature = signature.subarray(10);
  const trustedComment = lines[2].slice("trusted comment: ".length);
  if (!verify(null, Buffer.concat([payloadSignature, Buffer.from(trustedComment)]), ed25519Key, globalSignature)) {
    throw new Error("Updater trusted comment signature is invalid");
  }
  const versions = trustedComment.split("\t").filter((field) => field.startsWith("version:"));
  if (versions.length !== 1 || versions[0] !== `version:${version}`) {
    throw new Error(`Updater signature must bind release version ${version}`);
  }
  const artifact = await stat(artifactPath);
  if (!artifact.isFile() || artifact.size === 0) throw new Error("Updater artifact is missing or empty");
  let payload;
  if (algorithm === "ED") {
    const hash = createHash("blake2b512");
    for await (const chunk of createReadStream(artifactPath)) hash.update(chunk);
    payload = hash.digest();
  } else {
    payload = await readFile(artifactPath);
  }
  if (!verify(null, payload, ed25519Key, payloadSignature)) {
    throw new Error("Updater artifact signature is invalid");
  }
}

function requiredArtifacts(target, version) {
  switch (target) {
    case "aarch64-apple-darwin":
      return ["macos/EduPi.app.tar.gz"];
    case "x86_64-unknown-linux-gnu":
      return [`appimage/EduPi_${version}_amd64.AppImage`, `deb/EduPi_${version}_amd64.deb`];
    case "x86_64-pc-windows-msvc":
      return [`nsis/EduPi_${version}_x64-setup.exe`];
    default:
      throw new Error(`Unsupported updater release target: ${target}`);
  }
}

async function signaturePaths(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    // Files inside the App are resources, not generated updater artifacts.
    if (entry.isDirectory() && !entry.name.endsWith(".app")) paths.push(...await signaturePaths(path));
    else if (entry.name.endsWith(".sig")) {
      if (!entry.isFile()) throw new Error(`Updater signature is not a regular file: ${path}`);
      paths.push(path);
    }
  }
  return paths.sort();
}

export async function verifyUpdaterSignatures({ bundleRoot, target, version, configPath }) {
  assertVersion(version);
  const expected = requiredArtifacts(target, version).map((path) => join(bundleRoot, `${path}.sig`));
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.plugins?.updater?.requireSignedVersion !== true) {
    throw new Error("Production updater must requireSignedVersion");
  }
  const publicKey = config.plugins.updater.pubkey;
  if (typeof publicKey !== "string" || !publicKey.trim()) throw new Error("Updater public key is required");
  const signatures = await signaturePaths(bundleRoot);
  for (const path of expected) {
    if (!signatures.includes(path)) throw new Error(`Missing updater signature: ${path}`);
  }
  for (const path of signatures) {
    try {
      await verifyUpdaterSignature({ artifactPath: path.slice(0, -4), publicKey, version });
    } catch (error) {
      throw new Error(`${path}: ${error.message}`, { cause: error });
    }
  }
  return signatures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      "bundle-root": { type: "string" },
      target: { type: "string" },
      version: { type: "string" },
      config: { type: "string" },
    },
  });
  if (!values["bundle-root"] || !values.target || !values.version || !values.config) {
    throw new Error("Usage: verify-updater-signatures --bundle-root <bundle> --target <target> --version <version> --config <tauri-config>");
  }
  const signatures = await verifyUpdaterSignatures({
    bundleRoot: values["bundle-root"], target: values.target, version: values.version, configPath: values.config,
  });
  console.log(`Verified ${signatures.length} updater signatures and signed version ${values.version} for ${values.target}.`);
}
