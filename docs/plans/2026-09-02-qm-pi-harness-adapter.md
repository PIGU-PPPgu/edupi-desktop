# QM-derived Pi harness adapter — first slice

## Outcome

Introduce one internal adapter boundary around the existing Pi session startup while preserving
all current HTTP responses, commands, model selection, thinking level, tools, SSE behavior, and
EduPi teacher-context injection.

## Source and license

The adapter/profile/router/scope structure is adapted from
[`yc-software/qm`](https://github.com/yc-software/qm) revision
`b384c6548eb07d6531a26295367fdf9e8be4636a`. The copied copyright notice,
complete MIT license, and file-level attribution live in
`src-tauri/resources/third-party/qm/`.

## Boundary

- `runtime.ts` is the sole direct importer of `startRpcSession`.
- The four existing session-start routes call `startHarnessSession` with their unchanged
  positional values and options.
- The sole registered/default adapter is Pi. No `harnessId` is accepted from clients and no
  multi-harness capability is advertised.
- The only truthful scope is `teacher_internal` / `teacher:local`. It is forwarded through the
  adapter but does not yet alter prompts, tools, storage, or permissions.
- `rpc-manager.ts`, `AgentSessionWrapper`, Core bridges, teacher-context injection, and client
  response JSON remain unchanged.

## Transitional limitation

The auto-name route and other session-manager access still depend on the Pi-specific
`AgentSessionWrapper.inner` handle. Alternate adapters must remain disabled until this handle
leakage is replaced by an adapter-owned title/session-management contract.

## Verification

- Unit tests cover profile binding, router default/unknown behavior, scope identity, and complete
  Pi start argument/result transparency.
- A source contract test requires exactly the four production routes to use the harness runtime,
  forbids direct route imports of `startRpcSession`, and keeps the new-session response free of
  harness claims.
- Existing RPC, teacher-context, SSE, and route tests remain the regression gate.

## Rollback

Revert the four route imports/calls and delete `lib/harness/`. No session files, public API fields,
or Core data formats require migration.
