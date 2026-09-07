// Adapted from QM's harness router at b384c6548eb07d6531a26295367fdf9e8be4636a.
import type { Harness, HarnessSessionStartInput, HarnessSessionStartResult } from "./harness.ts";

export interface HarnessRouter {
  start(input: HarnessSessionStartInput, internalHarnessId?: string): Promise<HarnessSessionStartResult>;
}

export function createHarnessRouter(
  adapters: ReadonlyMap<string, Harness>,
  defaultHarnessId: string,
): HarnessRouter {
  if (!adapters.has(defaultHarnessId)) {
    throw new Error(`default harness ${defaultHarnessId} is unavailable`);
  }

  return {
    async start(input, internalHarnessId = defaultHarnessId) {
      const adapter = adapters.get(internalHarnessId);
      if (!adapter) throw new Error(`harness ${internalHarnessId} is unavailable`);
      return adapter.sessions.start(input);
    },
  };
}
