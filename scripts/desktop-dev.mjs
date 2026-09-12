import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(desktopRoot, "..");
const defaultEduPiRoot = resolve(workspaceRoot, "edupi");
const defaultBundledCoreRoot = resolve(desktopRoot, "src-tauri/resources/edupi-core");

function firstConfigured(environment, names) {
  return names.map((name) => environment[name]).find((value) => typeof value === "string" && value) ?? "";
}

function resolveConfiguredRoot(value) {
  return value ? resolve(value) : "";
}

export function resolveEduPiLaunchRoots(
  environment = process.env,
  siblingRoot = defaultEduPiRoot,
  bundledCoreRoot = defaultBundledCoreRoot,
) {
  const dataRoot = resolveConfiguredRoot(
    firstConfigured(environment, ["EDUPI_DATA_ROOT", "EDUPI_PROJECT_ROOT", "EDUPI_WORKSPACE"])
      || (existsSync(siblingRoot) ? siblingRoot : ""),
  );
  const explicitlyConfiguredCore = firstConfigured(environment, ["EDUPI_CORE_ROOT"]);
  const legacyConfiguredRoot = firstConfigured(environment, ["EDUPI_PROJECT_ROOT", "EDUPI_WORKSPACE"]);
  const coreRoot = resolveConfiguredRoot(
    explicitlyConfiguredCore
      || legacyConfiguredRoot
      || (existsSync(bundledCoreRoot) ? bundledCoreRoot : dataRoot),
  );
  const coreValidationMode = environment.EDUPI_CORE_VALIDATION_MODE
    || (explicitlyConfiguredCore || legacyConfiguredRoot ? "external" : "bundled");
  return {
    PI_DESKTOP_STATE_DIR: resolveConfiguredRoot(environment.PI_DESKTOP_STATE_DIR || ""),
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_CORE_VALIDATION_MODE: coreValidationMode,
    EDUPI_CORE_ALLOWED_ROOT: resolveConfiguredRoot(
      environment.EDUPI_CORE_ALLOWED_ROOT || (coreRoot ? dirname(coreRoot) : ""),
    ),
    EDUPI_DATA_ALLOWED_ROOT: resolveConfiguredRoot(
      environment.EDUPI_DATA_ALLOWED_ROOT || (dataRoot ? dirname(dataRoot) : ""),
    ),
  };
}

function launch() {
  const desktopApiToken = randomBytes(32).toString("hex");
  const roots = resolveEduPiLaunchRoots();
  if (!roots.PI_DESKTOP_STATE_DIR) {
    roots.PI_DESKTOP_STATE_DIR = resolve(tmpdir(), "edupi-desktop-dev-state");
  }
  const child = spawn(process.execPath, [tauriCli, "dev", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      PI_DESKTOP_API_TOKEN: desktopApiToken,
      ...roots,
    },
  });

  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) launch();
