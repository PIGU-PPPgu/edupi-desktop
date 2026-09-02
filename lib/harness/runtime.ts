import { startRpcSession } from "../rpc-manager.ts";
import type { RpcSessionStartOptions } from "../rpc-manager.ts";
import { createHarnessRouter } from "./harness-router.ts";
import { createPiHarness } from "./pi-harness.ts";
import { teacherInternalScope } from "./scope.ts";

const piHarness = createPiHarness({ startRpcSession });
const harnessRouter = createHarnessRouter(new Map([[piHarness.profile.id, piHarness]]), "pi");

export function startHarnessSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): ReturnType<typeof startRpcSession> {
  return harnessRouter.start({
    sessionId,
    sessionFile,
    cwd,
    options,
    scope: teacherInternalScope(),
  });
}
