// Adapted from QM's Pi harness profile at b384c6548eb07d6531a26295367fdf9e8be4636a.
import {
  defineHarness,
  type Harness,
  type HarnessSessionStartResult,
  type HarnessSessionStartOptions,
} from "./harness.ts";

export interface PiSessionStarter {
  (
    sessionId: string,
    sessionFile: string,
    cwd: string | undefined,
    options?: HarnessSessionStartOptions,
  ): Promise<HarnessSessionStartResult>;
}

export interface PiHarnessDependencies {
  startRpcSession: PiSessionStarter;
}

export function createPiHarness(dependencies: PiHarnessDependencies): Harness {
  return defineHarness(
    {
      id: "pi",
      controlTransport: "in-process",
      toolTransport: "in-process",
      transcriptFormat: "pi-jsonl",
      capabilities: new Set(["abort", "steer", "images", "thinking-level", "provider-sessions"]),
    },
    {
      async start(input) {
        return dependencies.startRpcSession(
          input.sessionId,
          input.sessionFile,
          input.cwd,
          input.options,
        );
      },
    },
  );
}
