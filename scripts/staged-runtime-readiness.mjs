export function stagedReadinessDiagnostic(result) {
  const { attempts, lastHttpStatus, lastStatus, lastError } = result;
  return JSON.stringify({
    attempts,
    httpStatus: lastHttpStatus,
    core: lastStatus?.core?.status ?? null,
    coreFailureStage: lastStatus?.core?.failureStage ?? null,
    coreLifecycle: lastStatus?.core?.lifecycle ?? null,
    projection: lastStatus?.projection?.status ?? null,
    kernel: lastStatus?.kernel?.status ?? null,
    compatibilityActual: lastStatus?.compatibility?.actual != null,
    error: lastError,
  });
}

export async function waitForStagedRuntime({
  deadline, identityOnly, headlessBoot, runtimeDatabaseExists,
  readIdentity, readStatus, serverExited, statusRequestTimeoutMs = 10_000, maxStatusAttempts = Infinity,
  pause = (ms) => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
}) {
  const result = { identityReady: false, status: null, runtimeStoreSeenBeforeStatus: false,
    attempts: 0, lastHttpStatus: null, lastStatus: null, lastError: null };
  while (now() < deadline && !(result.identityReady && (identityOnly || result.status))) {
    serverExited();
    try {
      const identity = await readIdentity(Math.max(1, Math.min(2_000, deadline - now())));
      if (identity.status === 204) {
        result.identityReady = true;
        if (identityOnly) break;
        if (!headlessBoot || runtimeDatabaseExists()) {
          if (headlessBoot) result.runtimeStoreSeenBeforeStatus = true;
          const remaining = deadline - now();
          if (remaining > 0) {
            result.attempts += 1;
            const response = await readStatus(Math.min(statusRequestTimeoutMs, remaining));
            result.lastHttpStatus = response.status;
            result.lastStatus = await response.json();
            result.lastError = null;
            if (response.ok && result.lastStatus?.core?.status === "ready"
              && result.lastStatus?.projection?.status === "ready") result.status = result.lastStatus;
          }
        }
      }
    } catch (error) {
      result.lastError = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
        ? "request_timeout" : "request_failed";
    }
    if (result.attempts >= maxStatusAttempts) break;
    if (!(result.identityReady && (identityOnly || result.status)) && now() < deadline) {
      await pause(Math.min(200, deadline - now()));
    }
  }
  return result;
}
