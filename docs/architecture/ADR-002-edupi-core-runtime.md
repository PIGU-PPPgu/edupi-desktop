# ADR-002：EduPi Core Runtime 是唯一受 fencing 保护的持续运行体

## Status

已接受（Accepted，2026-09-02）

## Date

2026-09-02

## Authority and parity

The normative owner of this decision is EduPi Core. Desktop is a supervisor,
recovery/control surface, and visible projection consumer; it is not a second
education state owner.

This ADR is copied byte-for-byte into the Core and Desktop repositories. The
Desktop mirror must remain byte-identical to the Core ADR until a versioned
successor is explicitly reviewed. A byte-different mirror is contract drift,
not a harmless documentation edit.

The user explicitly accepted the five-item decision gate on 2026-09-02. This
acceptance records the architecture and does not claim that the daemon,
fencing, or HarnessAdapter already exists; implementation evidence remains
task-specific below.

## Context

EduPi already has a useful but bounded local bridge and three deterministic
golden-task slices. The Phase 0 benchmark and value ledger freeze those
contracts, but they do not establish a resident runtime or full L4 evidence.

The current source evidence is:

- Tauri now packages Core and data-root support at Desktop commit 0906776,
  paired with Core commit ca623bd. The packaged Desktop keeps Next alive in the
  tray and stops its process tree on true quit.
- Desktop still calls runCoreProcess to spawn one-shot Core per request. This
  is an isolation boundary, not a resident Core lifecycle.
- Production scheduling is currently hosted by
  scripts/feishu_bridge.mjs::startHeartbeatScheduler. Its calendar execution
  path reaches executeCalendarWorkBatch through
  scripts/calendar_work_heartbeat.mjs.
- The packaged Core component manifest currently contains the one-shot bridge
  and the Typebox runtime closure. It does not contain the calendar model
  runner or the Pi execution dependencies.
- A concurrent QM-inspired HarnessAdapter task is unmerged and orthogonal. It
  can later implement the execution boundary described here, but it is not an
  ADR dependency and cannot silently redefine this contract.
- The existing v1.1 bridge, receipts, provenance, staging, work cases,
  calendar execution, review gates, and deterministic replay evidence remain
  valuable. They are not evidence that a daemon, a fenced authority, or a
  provider-backed resident execution path already exists.

The forces are therefore:

1. G1 needs internal work to continue without an active Chat session or
   connected channel.
2. One local data root must have exactly one mutation authority, including
   stale-process fencing; one process name or a best-effort lock file is not
   enough.
3. Core, Desktop, carriers, and model-agent hosts have different lifecycles
   and trust boundaries.
4. A Core outage must not take down the recovery UI or strand durable work.
5. Restart, upgrade, rollback, and model failure must preserve identity and
   idempotency.
6. The first implementation must stay local, reversible, bounded, and
   measurable rather than claiming distributed or E4/E5 guarantees.

## Decision

EduPi will introduce one separately supervised Node Core daemon per verified
local data root. Core is the only canonical education state and mutation owner.
The daemon owns normalized events, queue and scheduler state, work_case
execution, artifact commits, receipts, feedback, and retry decisions.

Tauri supervises the daemon and the packaged Next recovery/control UI. Channel
adapters and the model-agent HarnessAdapter are protocol participants only;
neither may store canonical education state or bypass Core mutation authority.

Runtime v1 is local-first and local-root-only for its single-writer guarantee.
A network, shared, UNC, or remote root is rejected with a visible
unsupported-root state. No split-brain safety is claimed for such roots.

The runtime protocol is distinct from the existing bridge payload contract.
Bridge payload version 1.1 remains the compatibility contract; a separate
runtime protocol version covers rendezvous, lifecycle, fencing, queue, and
health.

## Topology and roles

~~~text
                  Tauri supervisor
             stable rendezvous and lifecycle
                    │          │
                    │          └── packaged Next recovery/control UI
                    │                         │
                    │                         └── read health/snapshot,
                    │                             submit bounded requests
                    ▼
             loopback Core endpoint
                    │
        separate Core token + supervisor session
                    │
            Node Core daemon (one writer)
        ┌───────────┼────────────────────────────┐
        │           │                            │
 teacher_event   internal timer             leased HarnessAdapter
 channel input  durable queue/scheduler     result-only execution
        │           │                            │
        └───────────┴──────────────┬─────────────┘
                                   ▼
             canonical facts, work cases, artifacts,
             receipts, review state, retry/feedback
                                   │
          ChannelAdapter: Chat / Feishu / WeCom / DingTalk / voice
~~~

### 1. Tauri supervisor

Tauri starts, verifies, monitors, drains, and stops the Core child. It chooses
the stable loopback endpoint, Core token, and supervisor session ID for one
Tauri session. It passes only the minimum sanitized rendezvous data to the
trusted local server and keeps the existing Desktop API token separate from
the Core token.

Tauri controls the distinction between hiding a window in the tray and true
quit. A supervisor failure causes supervised children to self-exit; durable
claims are recovered on the next supervisor session.

### 2. Separate Node Core daemon

The daemon owns the single fenced mutation authority for one verified local
data root. It accepts normalized teacher_event and internal timer events,
persists them before acknowledgement, schedules due work, invokes leased
execution, commits artifacts and transitions, and emits receipts and health.

Core may be ready for internal planning when no channel is connected. Channel
or harness outages degrade the affected capability while durable queue and
work_case state remain available.

### 3. Packaged Next recovery/control UI

Next starts even when Core is failed or still restarting. It connects to the
same stable endpoint and renders explicit unavailable/degraded state; it does
not create a local fallback education store. It may read health/snapshot
compatibility data and submit bounded commands through Core, subject to the
same request security and receipt rules.

### 4. ChannelAdapter

ChannelAdapter is the carrier-neutral interface:

~~~text
connect / receive / send / capabilities / health
~~~

It normalizes carrier input into teacher_event, reports verified delivery IDs
when a send is authorized, and exposes capability health. It cannot own
education timers, mutate canonical state, declare completion, or bypass the
external-send policy. Desktop Chat, Feishu, WeCom, DingTalk, and future voice
carriers implement this boundary independently.

### 5. HarnessAdapter

HarnessAdapter is a leased model-agent execution boundary for Pi, Codex, or
another approved execution host. It receives a bounded lease containing:

- work_case_id;
- execution fingerprint;
- attempt;
- claim token;
- fencing generation;
- input/source revision;
- deadline and cancellation signal;
- capability/result protocol version;

The lease request is separate from the Harness response contract. The request
is issued by Core and carries the work_case identity, execution fingerprint,
attempt, claim token, fencing generation, input/source revision, deadline and
cancellation context, and the capability/request protocol version. The
response is a bounded, versioned result or typed failure bound back to that
issued lease by work_case_id, execution fingerprint, attempt, claim token,
fencing generation, request protocol version, and source revision. Core
rejects a response whose binding, version, deadline, or source context does
not match the issued lease; Core remains the only committer.

The Harness has no data-root write access. It cannot declare draft_ready and
cannot write facts, tasks, receipts, artifacts, or review state. Core validates
the current work_case claim, claim token, fencing generation, source revision,
deadline, result protocol version, output schema, and evidence before it
exclusively commits an artifact or transition. complete and fail are
idempotent. Lease expiry or cancellation durably requeues or fails the claim
according to the capability policy.

The unmerged QM-inspired Harness work may later provide an implementation, but
it must conform to this leased, result-only contract and cannot redefine it
silently.

## Fenced mutation authority

### Authority identity

There is exactly one fenced mutation authority per local data root, not merely
one daemon process. The authority record binds all of the following:

- data-root fingerprint;
- monotonic fencing generation;
- owner instance nonce;
- supervisor session ID;
- process identity;
- process start evidence.

Every canonical mutation, receipt commit, and artifact commit verifies the
current generation and owner identity at commit time. A stale process fails
closed even when its process is still alive.

The existing short-lived safe_store locks remain useful for individual atomic
writes, but they are not the root authority lease and cannot substitute for
fencing generation.

### Acquisition and takeover

Initial acquisition creates one authority record atomically. A takeover is
allowed only after positive owner-death evidence for the recorded process and
an atomic compare-and-swap takeover that increments the fencing generation.
Timeout alone, an expired timestamp, or blind lock-file unlink is insufficient.

If positive owner-death evidence or atomic takeover cannot be established, the
new writer fails closed and reports an unavailable authority. The old owner
must not be assumed dead because a heartbeat is late.

### Current writer boundary

While the authority exists:

- mutating one-shot bridge operations route through the daemon or fail closed;
- legacy carrier-owned scheduler and Feishu writers route through the daemon
  or fail closed;
- Agent extension direct writers route through the daemon or fail closed;
- raw cross-file writers route through the daemon or fail closed;
- read-only health and snapshot compatibility may remain available.

Task 6 includes a mutating-entrypoint and caller audit plus an enforcement
gate. It must not claim single-writer completion until every current writer is
routed or blocked. No legacy writer is silently disabled by this ADR.

### Local-root-only exclusion

Runtime v1 verifies that the data root is a supported local filesystem root.
Known network, shared, UNC, and remote roots return unsupported-root and never
enter the single-writer guarantee. The system does not claim fencing across
hosts, network partitions, clock disagreement, or a shared filesystem whose
owner-death evidence cannot be trusted.

### Rollback

Rollback is serialized:

1. stop new daemon intake, channel intake, and UI mutation requests;
2. drain or durably requeue active claims;
3. stop the daemon and release/verify the authority;
4. verify the old writer is not authoritative;
5. enable one-shot compatibility;
6. keep only one mutation writer active.

The reverse sequence is used to return to the daemon. There is never a
daemon-plus-one-shot dual-writer window.

## Restart-safe rendezvous and security

Tauri chooses one loopback endpoint, one separate Core token, and one
supervisor session ID for the duration of the Tauri session. These three
values remain stable across Core child restarts. Every new Core child gets a
new instance nonce.

Core readiness is accepted only when the handshake binds:

- runtime protocol version;
- supervisor session ID;
- Core instance nonce;
- Core commit;
- Core component manifest hash;
- data-root fingerprint;
- fencing generation.

The runtime protocol version is not the bridge v1.1 payload version. A bridge
payload can remain compatible while a runtime handshake is rejected.

The Next recovery/control UI starts independently of Core readiness. It
reconnects to the stable endpoint after a Core crash without requiring a Next
restart and displays the bounded failure state.

The Core token is never exposed to the WebView. Tauri captures it for the
trusted local server, removes it from ambient process.env before Agent,
extension, or tool initialization, and adds it to every subprocess
sanitization and denylist. The existing Desktop API token is a separate
credential with a separate scope and lifecycle.

Loopback Host checks, authentication, request-body bounds, response/output
bounds, timeout and abort behavior, and redacted metadata-only logs remain
mandatory. Tokens, private paths, teacher content, raw model output, and
authorization material are not written to logs or diagnostics.

## Events, queue, and execution boundaries

Core owns:

- normalized teacher_event and opaque actor/scope references;
- internal timer events and durable queue state;
- scheduler decisions and deduplication;
- work_case execution claims and artifact revisions;
- receipts, teacher review, feedback, and retry decisions.

Actor, scope, and carrier references are opaque in runtime v1. Cross-carrier
person/entity merging is deferred to Fact Spine and is never guessed by an
adapter or a channel label.

Queue storage technology is not a public contract. Task 6 first benchmarks
the existing bounded atomic safe-store and chooses SQLite or another
dependency only if crash/replay evidence demonstrates that the current store
cannot meet the contract. Storage selection is reversible and does not change
the bridge object model.

A queue acknowledgement means the event is durably recorded, not that a
model result or teacher-visible artifact exists. Each claim, completion, fail,
expiry, cancellation, and retry is idempotent under the work_case,
execution fingerprint, attempt, fencing generation, and source revision.

## Lifecycle, health, and failure behavior

Runtime lifecycle is separate from capability health:

~~~text
starting → ready → degraded → draining → stopped
                    └──────────────→ failed
~~~

Store, scheduler, harness, and channel health are reported independently.
Core may remain ready for internal planning with no channel. A harness or
channel outage degrades only its capability and leaves durable work
recoverable. Model unavailable is a typed failure and never becomes
draft_ready.

A Core child crash triggers bounded restart and backoff on the same endpoint,
Core token, and supervisor session. The replacement child has a new instance
nonce and recovers the fencing record and durable queue before accepting
mutations. If recovery cannot prove the authority or queue state, it remains
failed/unavailable rather than guessing.

Tauri failure causes supervised children to self-exit. Any claimed work is
reconciled on the next supervisor session. Next failure does not grant itself
mutation authority; it restarts as a recovery/control client.

### Bounded shutdown ordering

Entering draining atomically rejects all new command, mutation, and event
submissions; channel and UI requests; internal timer work; and new
HarnessAdapter lease acquisition or claims. Settlement and cancellation for
already-issued Harness leases remain accepted. Health/lifecycle reads and
Core-internal drain, requeue, and flush operations continue while draining.

True quit and upgrade use the following order:

1. stop new channel and UI intake;
2. keep HarnessAdapter alive so active claims can settle;
3. stop new Core claims and internal timers;
4. drain active claims to their deadline or durably requeue them;
5. flush durable queue, receipts, artifacts, and authority state;
6. stop Core and release/verify the fenced authority;
7. stop Next and finish the supervisor process tree.

The harness host is not stopped before active claims settle. An upgrade
repeats the same drain/requeue boundary before replacing the verified Core
bundle.

## Scope and implementation sequence

Task 5 extracts and reuses one shared request dispatcher with one-shot parity.
It does not change education semantics or introduce a second object model.

Task 6 implements the deterministic resident Core daemon, fenced mutation
authority, durable queue, caller enforcement gate, and G1 orchestration using
an injected deterministic HarnessAdapter. It does not claim packaged/provider-backed end-to-end completion, a real provider or Pi bundle, or E4/E5 evidence.

Task 7 integrates Tauri and Next with the sanitized rendezvous and then uses a
real model-backed G1 HarnessAdapter only after the concurrent Harness task is
merged or isolated and its bundle/dependency boundary is reviewed. Task 7 is
the real model Task 7 boundary, not a Task 6 shortcut.

Task 8 runs the paired G1 continuity E2. Provider evidence is labeled
available or unavailable independently from deterministic local evidence.

Tasks 4–6 do not include Fact v1, memory migration, channel implementation,
external send, subconscious, consciousness, multi-agent, evolution, or UI
redesign. The existing bridge and Desktop behavior remain rollback targets
until the new owner is proven.

## Non-functional requirements

The initial contract has no invented uptime, latency, or p95 target. It
requires measurable properties instead:

- no acknowledged-event loss after a successful durable enqueue;
- deterministic replay and idempotency for event, claim, result, artifact, and
  receipt operations;
- a local-only single-writer guarantee with stale-process fencing;
- recovery UI availability when Core is starting, degraded, or failed;
- cross-platform reversible startup, shutdown, upgrade, and rollback;
- bounded queue, artifact, response, and metadata-log resource use;
- secret, path, teacher-content, and raw-model-output redaction;
- measurement before any performance or capacity target is adopted.

## Failure modes and required behavior

| Failure mode | Required behavior | Observable evidence |
| --- | --- | --- |
| Core daemon crash | Replacement child uses the same endpoint/token/session, gets a new nonce, and recovers queue/authority state or remains failed. | Restart test shows identity continuity, no duplicate commit, and explicit unavailable state on failed recovery. |
| Tauri crash | Supervised children self-exit; durable claims remain recoverable. | Supervisor cleanup and next-session replay test. |
| Next crash | Core remains authoritative; Next restarts as a client and reconnects. | Recovery UI starts independently and reads the same snapshot after reconnect. |
| Harness outage | Leases expire or cancel into durable requeue/failure; no artifact completion is guessed. | Deterministic unavailable/expiry test with no draft_ready. |
| Channel outage | Internal planning and queue continue; channel capability is degraded. | Core health remains usable without a connected ChannelAdapter. |
| Stale writer | Generation/nonce check rejects the mutation even if the old process is alive. | Stale-generation mutation test produces no receipt/artifact/state write. |
| Source revision | Current source revision invalidates or stales the claim/artifact; a new revision is queued. | Source-change replay and stale-artifact evidence. |
| Model unavailable | Typed unavailable/failed state is durable or explicitly bounded; never draft_ready. | G1/G3 model-unavailable verifier and projected state check. |
| Upgrade | New intake stops, claims drain or requeue, authority is released/verified, then the bundle changes. | Upgrade rehearsal with replay and rollback evidence. |
| Unsupported root | Network/shared/UNC/remote root fails closed with unsupported-root state. | Root classification test; no writer starts. |

## Alternatives considered

### Next in-process singleton

Rejected as the canonical runtime. A module singleton does not fence another
process, does not survive a Next restart, and cannot prove owner death or
stale mutation rejection. It remains a useful UI-local cache pattern only
when it is not a canonical education writer.

### Current one-shot Core plus Feishu scheduler

Retained as a compatibility and rollback target, but rejected as the resident
architecture. It ties internal education scheduling to a channel process,
cannot provide stable restart rendezvous, and leaves a wide mutating-caller
audit boundary.

### Rust Core rewrite

Deferred. Rust may be appropriate for a later supervisor or hardened service,
but rewriting education semantics before deterministic queue, fencing, and
replay evidence would multiply migration risk and obscure the existing bridge
contract.

### Operating-system service now

Deferred. An OS service could improve boot persistence but would add installer,
permissions, upgrade, and cross-platform lifecycle complexity before the local
single-writer contract is proven. Tauri supervision keeps the first rollout
reversible and provides a future host boundary.

## Consequences

### Positive

- One explicit Core owner prevents Desktop and carriers from becoming parallel
  education truth sources.
- Fencing generation and commit-time checks make stale-process writes
  observable and rejectable.
- Stable rendezvous lets the recovery UI survive a Core child restart.
- Result-only HarnessAdapter execution keeps model-agent hosts outside the
  data-root trust boundary.
- Durable queue, work cases, receipts, and source revisions give G1/G2/G3 a
  common replay and audit vocabulary.
- Local-root-only scope makes the first guarantee testable and reversible.

### Negative

- The system gains an extra Node process and a supervisor lifecycle.
- Fencing, caller audit, queue recovery, and shutdown ordering add migration
  and operational work before feature expansion.
- Unsupported network/shared roots may be unavailable even when a one-shot
  script could technically write there.
- Existing carrier and extension writers need explicit routing or fail-closed
  enforcement, and rollback must preserve one writer at a time.
- A real model-backed HarnessAdapter remains a later dependency and may expose
  additional latency, cost, and provider failure modes.

### Neutral

- Existing bridge v1.1 payloads and Desktop API token remain in place while
  the runtime protocol is versioned separately.
- Queue storage remains an implementation choice until crash/replay evidence
  selects it.
- ChannelAdapter can be connected or disconnected without changing Core
  ownership.
- The ADR describes contracts and gates; it does not assert that the daemon,
  fencing, or HarnessAdapter already exists.

## Mapping to the golden tasks

| Golden task | ADR participation | Not claimed by this ADR |
| --- | --- | --- |
| G1 before-class preparation | Core timer and queue can create a work_case; leased HarnessAdapter returns bounded results; Core commits artifacts and receipts; replay and model-unavailable gates remain explicit. | No resident daemon, provider artifact, teacher usefulness, or L4 completion is claimed. |
| G2 after-class observation | ChannelAdapter normalizes teacher_event; opaque actor/scope refs and Core review/receipt paths preserve observation and conflict boundaries. | Fact Spine, identity merging, memory migration, and cross-carrier matching are deferred. |
| G3 school-material package | Source revisions, capability result validation, stale artifacts, retry, teacher review, and internal-only scope use the same Core owner. | No capability package, real model output, external delivery, or completion claim is implemented here. |

## User acceptance record

The user reviewed and explicitly confirmed all five decisions on 2026-09-02:

1. use a separate resident Core daemon rather than a Next in-process singleton;
2. make Runtime v1 local-root-only and fail closed on network/shared/UNC/remote
   roots;
3. fence and route or fail closed every legacy mutating writer, including
   carrier-owned scheduling and extension/direct cross-file writers;
4. keep HarnessAdapter as a leased, result-only boundary with no data-root
   write access and no draft_ready authority;
5. implement deterministic Task 6 first, then the real model-backed Task 7.

Exact user decision: `确认 ADR-002 五项决策` (2026-09-02).

ADR-002 is accepted. Task 5 and Task 6 may proceed within this contract, while
their implementation and evidence remain separate; this record does not claim
that a daemon, fencing, or HarnessAdapter already exists.

## Task 7 security and lifecycle refinement — 2026-09-06

Task 7 keeps the accepted ownership model and narrows its process boundary.
Tauri starts a separate local supervisor/broker before starting Next. The
broker alone receives the raw Core bearer token and passes it only to the
resident Core child. Next receives a different, process-scoped client
capability for the broker; it never receives the raw Core authority.

The broker capability is deliberately narrower than Runtime Protocol v1. It
accepts only bridge reads `health` and `snapshot`, and bridge mutations
`command`, `students`, and `delete`. Lifecycle calls, event enqueue, connector
configuration, provider access, channel access, and external delivery are not
delegated to Next. The capability is captured once before application startup,
removed from ambient environment state, frozen for the process lifetime, and
removed from Agent/tool subprocess environments. This is a process-boundary
reduction, not a claim that arbitrary code already executing inside the
trusted Next process is OS-sandboxed from the narrow capability. Brokered
health rewrites `supported_operations` to this same five-operation set, so the
status projection cannot advertise direct one-shot capabilities that the
broker will reject.

The broker binds its stable loopback proxy and emits `supervisor_ready` before
starting Core. Tauri waits only for that broker identity before starting Next,
so the recovery UI is available while Core is starting, restarting, or failed.
Every later Core `ready` or `restarted` envelope is checked by Tauri against a
direct authenticated health request that binds the supervisor session, Core
commit, component manifest, data-root fingerprint, instance nonce, and fencing
generation. Next never substitutes a local education writer when the broker or
Core is unavailable.

The release mode is fixed for one Tauri session. Daemon mode keeps one Core
child behind the broker. One-shot rollback mode remains brokered, serializes
each allowed bridge request, and starts no resident Core daemon. Switching
modes requires a true stop followed by a new session, preserving the accepted
no-dual-writer rollback order.

Shutdown now has one broker-owned 20-second total deadline. It rejects new
proxy intake, drains or force-reaps the Core/one-shot children, closes the
proxy, and then exits. Tauri allows a 25-second transport/reap margin before
terminating the broker process group, and stops Next only after this Core
boundary. Both broker and Core arm parent-death supervision before Core startup
can retain writer authority; readiness parsing and response reads are bounded
before allocation or acceptance. Each brokered one-shot also arms an
independent worker-thread parent watchdog before it can acquire legacy writer
admission. The watchdog can terminate the process even when the one-shot main
thread is blocked in synchronous storage work.

Inbound headers and request bodies retain a five-second deadline. That deadline
does not govern an already validated operation response: read operations receive
their five-second operation deadline plus transport grace, while bridge
mutations and lifecycle drain/shutdown receive their fifteen-second operation
deadline plus transport grace. Core and the broker's Core-facing request each
allow one second beyond the operation deadline; the Next-facing client allows
two seconds, while the broker socket has a final three-second safety bound. A
client connection is therefore not silently cut at five seconds or at the same
instant as an admitted mutation's typed deadline response.

Runtime Protocol v1 adds the exact `bridge_call` operation for the three
reviewed bridge mutations while retaining `bridge_read` for the two reviewed
reads. The paired identity is schema
`sha256:315be5504ecffa382213d90211fc6263664bdcfcbb7974edb5994d0c3e7aaef2`
and Core daemon component
`sha256:3a9522bec208e38328ec2be91c7c170f1308fe412db63394d1c1c1c77c4c45e1`.
This refinement closes deterministic Desktop supervision only. Provider-backed
execution, network/channel activation, external sending, and the paired G1
continuity E2 remain later gates; defaults remain `activation_pending` and
`external_send=false`.

## Task 8 deterministic G1 continuity refinement — 2026-09-07

Task 8 keeps production event intake closed. The ordinary daemon factory still
reports `activation_pending`; only the explicitly branded, test-only Task 8
driver can supply a deterministic HarnessAdapter. That driver is excluded from
both production component manifests and has no AgentSession, provider, channel,
network, or external-send path.

Calendar-work execution state now retains an optional, bounded transition
history of at most 50 entries. Existing records without the field derive their
legacy transition view, while new and retried executions persist the exact
attempt-specific sequence. Validation canonicalizes timestamps to UTC, rejects
duplicate projected identities, enforces the per-attempt state machine and
requires the final transition to agree with the execution status. A later
attempt can begin only after the preceding attempt is failed or stale. The work
case projection sorts by the parsed instant and consumes the stored order
without exposing its internal marker. A retry can therefore preserve `queued →
running → failed → queued → running → draft_ready` even when adjacent
transitions share a timestamp.

The paired deterministic E2 injects one due timer, observes retryable
`model_unavailable`, kills and recovers Core, verifies attempt 2 reaches four
real hashed artifacts, restarts Core again, then restarts the complete Desktop
broker. Event, task, work-case, execution, receipt, artifact identities, source,
and transition order remain stable. The same object timeline was observed in
the browser; its running-session endpoint measured zero active Chat sessions,
with no connected channel and `external_send=false`.

Regression verification also closed a carrier readiness race: Feishu now starts
its heartbeat scheduler and installs SIGINT/SIGTERM handlers before publishing
`ready`. Startup remains crash-only before that synchronous publication
boundary, while an observable ready carrier can always run the admitted graceful
shutdown path.

The paired Runtime schema remains
`sha256:315be5504ecffa382213d90211fc6263664bdcfcbb7974edb5994d0c3e7aaef2`.
Current daemon and one-shot component identities are respectively
`sha256:0b168afb90b6d05e5c06e0fe984cd266a3f90d8c2240c0dccda520a2c274005d`
and
`sha256:ded08a3140f3e7aa5eb7c0604aabc308aa019473a4c12987837aab155df6f85c`.
This is deterministic local E2 evidence for G1 continuity, not provider-backed
teacher evidence, external delivery evidence, a packaged cross-platform proof,
or a product-wide L4 claim. Production defaults remain `activation_pending` and
`external_send=false`.
