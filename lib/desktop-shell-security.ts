import { createLocalBashOperations, type BashOperations, type BashSpawnContext } from "@earendil-works/pi-coding-agent";

const DESKTOP_SECRET_KEYS = [
  "PI_DESKTOP_API_TOKEN",
  "PI_DESKTOP_INSTANCE_ID",
  "EDUPI_CORE_CLIENT_TOKEN",
  "EDUPI_CORE_TOKEN",
  "EDUPI_CORE_ENDPOINT",
  "EDUPI_CORE_SUPERVISOR_SESSION",
  "EDUPI_CORE_SCHEMA_HASH",
  "EDUPI_CORE_COMMIT",
  "EDUPI_CORE_COMPONENT_MANIFEST_HASH",
  "EDUPI_CORE_DATA_ROOT_FINGERPRINT",
  "EDUPI_CORE_INSTANCE_NONCE",
  "EDUPI_CORE_FENCING_GENERATION",
  "EDUPI_CORE_ATTESTATION",
  "EDUPI_CORE_RELEASE_MODE",
] as const;

export function redactDesktopSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of DESKTOP_SECRET_KEYS) delete sanitized[key];
  return sanitized;
}

export function redactDesktopSpawnContext(context: BashSpawnContext): BashSpawnContext {
  return { ...context, env: redactDesktopSecrets(context.env) };
}

export function createDesktopSafeBashOperations(shellPath?: string): BashOperations {
  const local = createLocalBashOperations({ shellPath });
  return {
    exec: (command, cwd, options) => local.exec(command, cwd, {
      ...options,
      env: redactDesktopSecrets(options.env ?? process.env),
    }),
  };
}
