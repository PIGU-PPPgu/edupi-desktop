# EduPi Desktop Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make EduPi Desktop the visible, controllable body of Core: Chat-first teacher interaction, evidence-bound projection, explicit review/control, typed commands, receipts, and next-cycle refresh without a second education truth store.

**Architecture:** Preserve the existing Tauri + Next.js + Pi Web shell, Pi session/SSE lifecycle, file access, request security, and task-session binding behavior while moving its UI-only state out of Core .edupi output. Replace direct education JSON assumptions with a versioned Core snapshot consumer and typed command/receipt path. Split projection from commands around readEducationContract/buildEducationContract before adding deeper Today, Memory, teaching, follow-up, or action pages.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing Pi session/RPC/SSE APIs, Tauri 2, JSON fixture tests with Node test runner, ESLint, TypeScript no-emit checks, local HTTP smoke, and browser-visible verification.

**Execution note:** Actual execution in this project uses Sol Advisor New with Luna / Max implementation lanes and fresh Sol / Max review lanes. A Desktop worker must not substitute another role, model, or reasoning level. Bridge changes require the paired Core producer PR, fixture set, pinned commit/schema hash, and paired PR review.

---

## Scope, baseline, and product boundary

The clean Desktop baseline is commit ac57d533311968f406a8d53fa3f41c2168530e03. The original running Desktop workspace is inspection-only for this lane; preserve it and do not treat uncommitted changes as the clean baseline. Concurrent unrelated untracked `tmp/` PDF/research WIP was transiently observed during planning and disappeared through an external/concurrent process without this lane touching it; the original Desktop workspace is currently clean at verification time. Never clean, reset, stage, or delete future unrelated work; record and preserve actual status rather than forcing it to zero.

The canonical authority is the Core repository's docs/plans/2026-08-24-edupi-dual-spiral-roadmap.md. Core owns canonical teacher events, evidence, facts, memory, profiles, policies, work candidates, decisions, action plans, receipts, feedback, and learning candidates. Desktop owns visible projection, local UI state, task/session navigation, and typed command initiation only.

The shared append-only checkpoint ledger is the Core file docs/loop/DUAL_SPIRAL_CHECKPOINTS.md. Desktop must append evidence through that ledger; it cannot mark a shared checkpoint passed in a Desktop-only document.

Chat is the primary natural-language entrance. Navigation is a control/inspection surface answering what needs me now, what EduPi prepared, why it judged this, what needs confirmation, what it remembered, and how feedback changed the next cycle. Preserve the Notion-like content-first project/task/workspace direction, but visual improvement travels with a vertical slice; there is no early horizontal polish phase.

First checkpoint C1 is the complete teacher observation/memory loop:

1. teacher says an observation in Chat;
2. Core creates provenance-bound observation and memory candidate;
3. Desktop shows it in Today/Memory as needing confirmation;
4. teacher accepts, modifies, rejects, or holds;
5. Core atomically writes accepted memory/state and emits a receipt;
6. Desktop refreshes to show receipt/result; rejected material never becomes fact;
7. restart/replay proves continuity; external_send remains false.

No Desktop code may mutate Core JSON directly. No local cache or browser storage may become a second canonical store. Unknown contract version/schema, stale snapshot, invalid provenance, missing permission, and missing receipt all fail closed.

Foundation status rule: Desktop consumer/projection/command Tasks 1A–4, including Task 4E and Tasks 3A–3H for all existing write paths and task-session migration, are implementation substeps of C1. They may land as atomic commits and paired PRs but remain in_progress or evidence_pending; they cannot be reported as a passed product checkpoint alone. The first passed product checkpoint is the complete seven-step C1 loop with paired Core evidence and restart/replay.

## Non-goals and material risks

Non-goals for this plan are replacing Pi Chat, building a school administration dashboard, making navigation the truth source, copying third-party UI code or brands, a standalone visual-polish phase, automatic external messaging, automatic skill promotion, credential/provider management for ordinary teachers, opaque student scoring, AI diagnosis, raw chain-of-thought display, biological consciousness claims, or unrestricted computer-use automation.

Material risks are:

- readEducationContract/buildEducationContract currently span projection, imports, review, and task sessions. A broad refactor can break existing session/task behavior. Mitigation: pure projection tests first, command route second, one vertical slice at a time.
- Core and Desktop can drift semantically while TypeScript still compiles. Mitigation: pinned Core commit/schema hash and fixture manifest, paired PRs, semantic fixture comparison, and unknown-version fail-closed behavior.
- A UI can show success before Core writes a receipt or can fall back to a local JSON write. Mitigation: typed command client, receipt-required success state, no local fallback, and stale-snapshot tests.
- Cached or stale snapshots can overwrite a teacher correction. Mitigation: snapshot_id, idempotency_key, state hash, explicit stale receipt, and refresh-before-command.
- Visual polish can displace the real teacher workflow. Mitigation: every UI change is attached to a real teacher input, evidence, review, receipt, and next-cycle check; no horizontal polish phase.
- Desktop status can overclaim E4/E5 from a process, gateway, fixture, or model self-report. Mitigation: explicit evidence labels, real message IDs, independent teacher runbook, and release blocking on missing evidence.

## Structural hotspot and sequencing rule

Current lib/edupi-education-server.ts readEducationContract reads many Core JSON stores, builds the projection, discovers session state, and also hosts review/import/write paths. Current lib/edupi-education-contract.ts buildEducationContract normalizes tasks, memories, insights, subjects, family contacts, and documents. These functions affect:

- app/api/edupi/education/route.ts;
- calendar/timetable imports;
- task review actions;
- task-session binding;
- Today, Memory, task, evidence, insight, and growth views;
- existing workbench tests.

Split them before deeper pages:

1. lib/edupi-bridge-consumer.ts validates a Core snapshot envelope and pinned manifest;
2. lib/edupi-education-contract.ts remains a pure, read-only projection mapper;
3. lib/edupi-bridge-command-client.ts builds typed command envelopes;
4. app/api/edupi/commands/route.ts forwards commands and returns Core receipts;
5. readEducationContract becomes a read-only compatibility adapter or is deleted only after paired callers migrate;
6. command routes never write fallback JSON;
7. production buildEducationContract never synthesizes generatedStudentEvents, generatedTeachingMaterials, or material-candidate tasks. It maps only Core-provided tasks, candidates, observations, and facts. Existing synthesis is removed or quarantined as a migration-only test adapter that production code cannot import.

## Existing Desktop write-path migration and UI-state ownership

Phase 1 cannot exit while any production route directly mutates Core calendar, timetable, task, memory, or material JSON. The paired foundation PR set must migrate each path below to a Core typed command and Core receipt, or disable only its mutation control with a visible unavailable reason while leaving read-only projection available. A partial migration is not a passed phase.

| Existing path | Required destination | Desktop behavior during migration |
| --- | --- | --- |
| calendar import | import_calendar command -> Core receipt | Submit only through the typed command client; if Core semantics are unavailable, disable import with the reason and keep calendar projection read-only |
| timetable import | import_timetable command -> Core receipt | Same fail-closed behavior; no direct timetable JSON write |
| task review | review_task command -> Core receipt | Accept/modify/reject/hold/rollback are Core decisions; receipt is required before success |
| teacher observation/memory review | review_observation / review_memory_candidate command -> Core receipt | Use source_kind=memory_candidate for a candidate; never label it core_memory before acceptance |
| education material intake | intake_material command -> Core receipt | Preserve source hash/path/title in the Core command; no material_candidates.json write from Desktop |
| task-session binding | Desktop-owned server state, not Core truth | Migrate legacy .edupi/output/task_session_bindings.json to lib/edupi-desktop-state-server.ts under PI_DESKTOP_STATE_DIR; preserve only task_id, session_id, bound_at, and ui_status |

The planned Desktop-owned state path is lib/edupi-desktop-state-server.ts backed by atomic 0600 JSON plus a lock under PI_DESKTOP_STATE_DIR. Tauri computes app_config_dir and passes that env to the packaged server through the server launch path; web/dev uses the explicit ~/.pi/agent/desktop-state fallback. UI calls a Desktop API route, and the server validates task/session/project ownership. When Desktop state is absent, a one-time read-only migration may validate IDs from .edupi/output/task_session_bindings.json and write the server state; it must not edit/delete the legacy file. After migration, production code stops importing the legacy writer/reader. Core snapshots never include this binding as an education fact, evidence, memory, or teacher decision. Restart recovery preserves task/session IDs and derives running/idle/missing UI status from the current Pi session. APP_PREF_KEYS/getPref/setPref are not used for this state.

## Reachable Desktop writer inventory

The following production paths were inspected and must be closed or migrated before Phase 1:

| Current path | Current risk | Closure owner |
| --- | --- | --- |
| lib/edupi-education-server.ts | calendar/timetable imports, dynamic teacher_task_review.mjs task review, and task-session binding writes | Tasks 3A, 3C, 3D; typed Core commands or visible read-only |
| lib/edupi-onboarding-server.ts + app/api/edupi/onboarding/route.ts | GET loadTeacherContext reads raw Core preferences and POST saveTeacherContext writes preferences.json | Task 3F; validated Core snapshot for GET and review_teacher_context Core command/receipt for POST, with no fallback |
| components/EduPiEducationPanel.tsx | uploadMaterials can write .edupi/inbox/teacher-materials through generic /api/files | Tasks 3G–3H; Desktop staging then intake_material |
| components/EduPiEducationHome.tsx | legacy material upload path can bypass the workbench | Task 3H; route into staging or disable |
| components/FileExplorer.tsx | reachable teacher-material target paths can reach generic writer | Task 3H; route into staging or disable |
| components/SessionSidebar.tsx | reachable teacher-material target paths can reach generic writer | Task 3H; route into staging or disable |
| app/api/files/[...path]/route.ts | generic writer can mutate Core-reserved paths | Task 3E; reject .edupi/memory, .edupi/output, and .edupi/inbox mutations from Desktop product routes while retaining allowed read-only access |
| app/api/desktop/save/route.ts | native-dialog save can bypass generic file route guards | Task 3E; apply the same realpath/symlink/encoded-traversal/reserved-root guard while preserving desktop token/request security |
| app/api/edupi/status/route.ts + components/EduPiWorkspace.tsx | direct Core JSON status reads can be reached by the live AppShell/admin caller | Task 2A; migrate to validated health/snapshot envelopes through lib/edupi-core-process-client.ts or retire/disable the surface visibly |

No production direct writer may remain reachable after Phase 1. A control whose Core command is not in supported_commands is visibly disabled/read-only with a reason; it must not silently call the old writer.

## Safe material staging contract

Material upload first lands in a Desktop-owned staging directory outside Core .edupi: join(PI_DESKTOP_STATE_DIR, material-staging). The staging service validates allowed root, file type, count, size, and name; writes 0600 bytes; assigns staging_id; and computes SHA-256. Desktop then issues intake_material with staging_id, staging_path scoped to the configured staging root, expected source_hash, bounded kind/title/size, and source_scope=desktop_staging. Core realpath-validates the staging root, verifies hash/size, atomically copies/ingests into Core truth, and returns a receipt. Desktop deletes staging only after an accepted receipt or explicit teacher cleanup; failed staging remains visible/auditable. Generic file routes cannot bypass this flow into Core-reserved paths.

Do not run next build during development. Project instructions require node_modules/.bin/tsc --noEmit and npm run lint; next build pollutes .next and breaks npm run dev.

## Production Core process client

Desktop server owns lib/edupi-core-process-client.ts. It invokes only process.execPath with the exact realpath-resolved configured Core root plus the constant relative `scripts/desktop_bridge_port.mjs`, `shell: false`, and cwd fixed to the validated Core root. It independently realpath-validates root, cwd, and entry; cwd must equal root, the entry must be a contained regular file, and its exact relative path plus SHA-256 bytes must be manifest-covered before spawn. It rejects missing/unreadable or directory entries, root/cwd mismatch, escaping entrypoint symlinks, manifest omission, and hash mismatch before child launch; an in-root symlink is accepted only when its resolved regular file identity is pinned. It never dynamically imports Core, accepts an arbitrary script, opens a network port, launches a daemon, invokes a browser, or uses a shell.

The client sends one bounded JSON request on stdin for health, snapshot, or command and accepts exactly one JSON response envelope on stdout. It rejects extra stdout frames, nonzero exit, malformed JSON, wrong producer/version/schema hash, empty output, request >256 KiB, stdout >2 MiB, stderr >64 KiB, deadline overrun, or abort. Health/snapshot deadline is 5 seconds; command deadline is 15 seconds; abort/timeout kills the child and returns a structured unavailable result. The environment is an allowlist of validated Core paths/mode/locale/non-secret values. Desktop API routes keep loopback/request-security/desktop-token checks; child transport is not external authorization.

The health response and every validated CoreSnapshot carry supported_commands: CoreCommandType[]:

~~~typescript
export interface DesktopBridgeHealthPayload {
  status: "ready";
  supported_operations: Array<"health" | "snapshot" | "command">;
  supported_commands: CoreCommandType[];
  supported_projections: ProjectionType[];
}
~~~

Initial `supported_commands` and `supported_projections` values are []; after paired Core Task 7E and Desktop Task 4E proof, `supported_commands` contains exactly review_observation and review_memory_candidate. C10/C11 projections accumulate later through Tasks 13E10 and 14E11.

Before spawn, the client realpath-validates the Core root inside an allowed root, checks the fixed entrypoint and pinned manifest/contract identity, and verifies the pinned Git commit in development. Packaged release uses a bundled reviewed Core runtime plus signed/hashed component manifest and does not require Git.

Exact future client files/tests:

- lib/edupi-core-process-client.ts
- lib/edupi-core-process-client.test.mjs
- lib/edupi-core-root.ts
- lib/edupi-core-root.test.mjs
- scripts/test-edupi-core-process-client.mjs

Tests must cover fixed script/cwd/shell:false, health/snapshot/command, malformed and extra frames, nonzero exit, identity/hash mismatch, request/output/stderr limits, timeout, abort/kill, redaction, and idempotent command retry.

## Bridge consumer contract and exact future files

Core producer files:

- contracts/edupi-bridge-v1.ts
- contracts/edupi-bridge-v1.schema.json
- contracts/edupi-bridge-hash.json
- scripts/edupi_bridge_snapshot.mjs
- scripts/edupi_bridge_command.mjs
- scripts/edupi_bridge_receipt.mjs
- scripts/desktop_bridge_port.mjs
- scripts/desktop_bridge_limits.mjs
- fixtures/bridge/v1/snapshot-observation-memory.json
- fixtures/bridge/v1/receipt-review-memory.json
- fixtures/bridge/v1/fixture-manifest.json

Desktop consumer files:

- lib/edupi-bridge-contract.ts
- lib/edupi-bridge-manifest.ts
- lib/edupi-bridge-consumer.ts
- lib/edupi-bridge-command-client.ts
- lib/edupi-core-process-client.ts
- lib/edupi-core-process-client.test.mjs
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/snapshot-observation-memory.json
- fixtures/edupi-bridge/v1/command-review-memory.json
- fixtures/edupi-bridge/v1/receipt-review-memory.json

The Desktop manifest pins the active Core runtime only in one top-level `core_runtime` object, plus contract_version/schema/fixture provenance, supported command types, and paired PR/change note. `contract_identities` do not carry a second active Core commit.

~~~json
{
  "compat_manifest_version": "1.0",
  "core_repository": "edupi",
  "core_runtime": {
    "core_commit": "8e56119848b555539b9f1bdfae386f195fcff0c2",
    "component_manifest_path": "contracts/edupi-desktop-component-manifest.json",
    "component_manifest_hash": "sha256:component-manifest-v1"
  },
  "contract_identities": [{
    "contract_id": "edupi-bridge-v1",
    "contract_version": "1.0",
    "schema_hash": "sha256:core-bridge-v1",
    "fixture_manifest_path": "fixtures/edupi-bridge/v1/fixture-manifest.json",
    "fixture_manifest_hash": "sha256:fixtures-v1",
    "supported_commands": [],
    "supported_projections": [],
    "depends_on": []
  }],
  "cumulative_projection_manifest": null,
  "supported_commands": [],
  "supported_projections": [],
  "unsupported_command_reasons": {
    "review_observation": "awaiting Core Tasks 5–7 handlers/fixtures and Desktop consumer proof",
    "review_memory_candidate": "awaiting Core Tasks 5–7 handlers/fixtures and Desktop consumer proof",
    "review_task": "awaiting paired Core handler and fixture proof",
    "review_teacher_context": "awaiting Core Task 9E2 and Desktop Task 6E2 handler/fixture proof",
    "review_work_candidate": "awaiting Core Task 10E3 and Desktop Task 7E3 handler/fixture proof",
    "review_teaching_adjustment": "awaiting Core Task 11E4 and Desktop Task 8E4 handler/fixture proof",
    "review_follow_up": "awaiting Core Task 12E5 and Desktop Task 9E5 handler/fixture proof",
    "import_calendar": "awaiting paired Core handler and fixture proof",
    "import_timetable": "awaiting paired Core handler and fixture proof",
    "intake_material": "awaiting paired Core handler and fixture proof",
    "review_insight": "awaiting Core Task 14E7 and Desktop Task 11E7 handler/fixture proof",
    "review_growth_candidate": "awaiting Core Task 15E8 and Desktop Task 11E8 handler/fixture proof",
    "review_learning_candidate": "awaiting Core Task 15E8 and Desktop Task 11E8 evaluation/reload/route-use proof",
    "request_action_preview": "awaiting paired Core policy, receipt, and fixture proof",
    "approve_action": "awaiting Core Task 16E9 and Desktop Task 12E9 permission/receipt proof",
    "stop_action": "awaiting Core Task 16E9 and Desktop Task 12E9 emergency-stop proof",
    "report_action_result": "awaiting Core Task 16E9 and Desktop Task 12E9 claim/final attestation, replay, and crash-recovery proof"
  },
  "unsupported_projection_reasons": {
    "external_delivery": "awaiting Core Task 17E10 and Desktop Task 13E10 fixed-port proof",
    "teacher_outcome_evidence": "awaiting Core Task 18E11 and Desktop Task 14E11 fixed-port proof"
  },
  "paired_prs": [],
  "change_note": "Initial schema-only C1 manifest; all commands and projections remain visibly disabled until paired proof"
}
~~~

The compatibility manifest is additive and multi-contract, not a single mutable identity. `contract_identities` is ordered bytewise by `(contract_id, contract_version, fixture_manifest_path)` and rejects duplicate or unknown identities, missing fields, unknown child-manifest hashes, or a `depends_on` identity that is not pinned. C10 adds `{ contract_id: "edupi-bridge-v2", contract_version: "2.0", fixture_manifest_path: "fixtures/edupi-bridge/v2/fixture-manifest.json", supported_projections: ["external_delivery"], depends_on: ["edupi-bridge-v1@1.0"] }`; C11 adds `{ contract_id: "edupi-outcomes-v2.1", contract_version: "2.1", fixture_manifest_path: "fixtures/edupi-bridge/v2.1/fixture-manifest.json", supported_projections: ["external_delivery", "teacher_outcome_evidence"], depends_on: ["edupi-bridge-v2@2.0"] }`. When either projection is present, `cumulative_projection_manifest` pins its path, hash, and ordered member identities. Top-level effective supported_commands/supported_projections are explicit intersections of proven entries and fail closed; v1 remains pinned and unchanged.

Every Desktop E re-pin task updates the same top-level `core_runtime.core_commit`, `component_manifest_path`, and `component_manifest_hash` from its paired Core E task, alongside its contract/schema/fixture/capability proof. No contract identity may introduce an active runtime commit, and a stale or multiple runtime identity fails closed before spawn or routing.

fixture_manifest_hash is computed from the committed Core/consumer fixture manifest excluding fixture-manifest.json itself: sort the other relative POSIX paths bytewise, hash each raw file, serialize the sorted entries as canonical UTF-8 JSON, then hash those entries bytes. The final manifest stores algorithm/files/fixture_manifest_hash; Desktop rejects a copied fixture set whose verifier hash differs. TypeScript formatting is irrelevant.

The schema defines all bounded command variants so producer/consumer validation can detect semantic drift, but runtime capability is narrower. contracts/edupi-core-compat.json lists only handlers/projections proven by the pinned Core commit and paired fixtures. Initial capability is supported_commands: [] and supported_projections: []. It remains empty until Core Tasks 5–7 handlers/fixtures and Desktop consumer proof land; the paired manifest update may then enable only review_observation and review_memory_candidate. review_task, calendar/timetable/material commands, all four C9 action commands (request_action_preview, approve_action, stop_action, report_action_result), external_delivery, and teacher_outcome_evidence remain absent from their respective capability lists and must be visibly disabled/read-only with the manifest reason until their paired Core handlers/projections, fixtures, schema hash, and PR review land. A control absent from supported_commands or supported_projections must never optimistically call the route.

The consumer validates the complete wire envelope before projection:

~~~typescript
export const CONTRACT_VERSION = "1.0" as const;
export type ContractVersion = typeof CONTRACT_VERSION;
export type StableId = string;
export type EvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4" | "E5";
export type TeacherReviewState =
  | "not_required" | "pending_review" | "accepted" | "modified"
  | "rejected" | "held";
// v1 is local and teacher-internal. The wire value is the JSON boolean false.
export type ExternalSendState = false;
export type CoreCommandType =
  | "review_observation"
  | "review_memory_candidate"
  | "review_task"
  | "review_teacher_context"
  | "review_work_candidate"
  | "review_teaching_adjustment"
  | "review_follow_up"
  | "import_calendar"
  | "import_timetable"
  | "intake_material"
  | "review_insight"
  | "review_growth_candidate"
  | "review_learning_candidate"
  | "request_action_preview"
  | "approve_action"
  | "stop_action"
  | "report_action_result";
export type ProjectionType = "external_delivery" | "teacher_outcome_evidence";
export type ExecutionOwner = "core" | "desktop_native";
export type ActionResultPhase = "claim" | "final";
export type ActionResultStatus = "completed" | "failed" | "stopped";
export type ActionState = "previewed" | "authorized" | "executing" | "stop_requested"
  | "completed" | "failed" | "stopped" | "authorization_expired" | "outcome_unknown";
export type ActionTokenState = "absent" | "issued" | "claimed" | "invalidated" | "expired" | "redacted";
export type ReceiptPhase = "review" | "preview" | "authorization" | "claim" | "result" | "mutation" | "stop";
export type ReceiptReasonCode =
  | "authorization_required" | "authorization_expired" | "outcome_unknown"
  | "forged_report" | "mismatched_report" | "invalid_decision" | "invalid_target"
  | "stale_snapshot" | "unknown_schema_hash" | "unsupported_command"
  | "invalid_envelope" | "duplicate_idempotency" | "permission_denied" | "timeout" | "internal";
export interface ActionAuthorization {
  execution_owner: "desktop_native";
  execution_token: string;
  action_spec_hash: string;
  expires_at: string;
  authorization_revision: number;
  authorization_snapshot_id: StableId;
  authorization_state_hash: string;
}
export interface DesktopNativeAttestation {
  native_execution_id: StableId;
  invocation_command: "open_path";
  target_identity_hash: string;
  report_hash: string;
  observed_at: string;
  evidence_ids: StableId[];
}
export type ReceiptStatus =
  | "accepted" | "modified" | "rejected" | "held" | "failed"
  | "stale_snapshot" | "unknown_version" | "authorized" | "executing" | "stop_requested"
  | "completed" | "stopped" | "authorization_expired" | "outcome_unknown";
export type ReviewDecision =
  | "accept" | "modify" | "reject" | "hold" | "rollback"
  | "snooze" | "suppress" | "not_useful" | "approve" | "stop";

// JSON Schema and every producer/consumer test enforce this exact pairing;
// an absent/invalid pair fails closed before dispatch.
export const COMMAND_DECISION_MATRIX = {
  review_observation: ["accept", "modify", "reject", "hold"],
  review_memory_candidate: ["accept", "modify", "reject", "hold"],
  review_task: ["accept", "modify", "reject", "hold", "rollback"],
  review_teacher_context: ["accept", "modify", "reject", "hold"],
  review_work_candidate: ["accept", "modify", "reject", "hold", "snooze", "suppress"],
  review_teaching_adjustment: ["accept", "modify", "reject", "hold"],
  review_follow_up: ["accept", "modify", "reject", "hold"],
  import_calendar: [null],
  import_timetable: [null],
  intake_material: [null],
  review_insight: ["accept", "reject", "hold", "not_useful", "suppress"],
  review_growth_candidate: ["accept", "reject", "hold"],
  review_learning_candidate: ["accept", "reject", "hold"],
  request_action_preview: [null],
  approve_action: ["approve"],
  stop_action: ["stop"],
  report_action_result: [null]
} as const satisfies Record<CoreCommandType, readonly (ReviewDecision | null)[]>;

export interface Provenance {
  source_kind: "teacher_message" | "teacher_file" | "core_event"
    | "memory_candidate" | "core_memory" | "core_task"
    | "channel_receipt" | "desktop_native_attested" | "fixture";
  source_id: StableId;
  source_path: string | null;
  source_hash: string | null;
  observed_at: string;
  actor: "teacher" | "core" | "channel" | "fixture";
  evidence_ids: StableId[];
  parent_ids: StableId[];
}

export interface TeacherReview {
  state: TeacherReviewState;
  reviewer_id: StableId | null;
  reviewed_at: string | null;
  note: string | null;
  revision: number;
}

export interface BridgeEnvelope<TPayload> {
  contract_version: ContractVersion | string;
  message_id: StableId;
  request_id: StableId;
  issued_at: string;
  producer: "edupi-core";
  schema_hash: string;
  snapshot_id: StableId;
  provenance: Provenance[];
  teacher_review: TeacherReview;
  external_send: ExternalSendState;
  payload: TPayload;
}

export interface EducationObservation {
  observation_id: StableId;
  text: string;
  subject: string | null;
  class_id: StableId | null;
  student_ids: StableId[];
  observed_at: string;
  provenance: Provenance[];
  evidence_ids: StableId[];
  inference_status: "observed" | "candidate_only" | "confirmed";
  teacher_review: TeacherReview;
}

export interface MemoryCandidate {
  candidate_id: StableId;
  category: "semester" | "class" | "teaching" | "preferences" | "school";
  proposed_content: string;
  tags: string[];
  based_on_observation_ids: StableId[];
  conflicts_with_memory_ids: StableId[];
  evidence_ids: StableId[];
  inference_status: "candidate_only";
  teacher_review: TeacherReview;
  external_send: false;
}

export interface CoreMemory {
  memory_id: StableId;
  category: "semester" | "class" | "teaching" | "preferences" | "school";
  content: string;
  state: "active" | "superseded";
  provenance: Provenance[];
  evidence_ids: StableId[];
  accepted_from_candidate_id: StableId;
  accepted_at: string;
}

export type ReviewTargetRef =
  | { target_kind: "observation"; target_id: StableId; command_type: "review_observation" }
  | { target_kind: "memory_candidate"; target_id: StableId; command_type: "review_memory_candidate" }
  | { target_kind: "task"; target_id: StableId; command_type: "review_task" }
  | { target_kind: "teacher_context"; target_id: StableId; command_type: "review_teacher_context" }
  | { target_kind: "work_candidate"; target_id: StableId; command_type: "review_work_candidate" }
  | { target_kind: "teaching_adjustment"; target_id: StableId; command_type: "review_teaching_adjustment" }
  | { target_kind: "follow_up"; target_id: StableId; command_type: "review_follow_up" }
  | { target_kind: "calendar_import"; target_id: StableId; command_type: "import_calendar" }
  | { target_kind: "timetable_import"; target_id: StableId; command_type: "import_timetable" }
  | { target_kind: "material_intake"; target_id: StableId; command_type: "intake_material" }
  | { target_kind: "insight"; target_id: StableId; command_type: "review_insight" }
  | { target_kind: "growth_candidate"; target_id: StableId; command_type: "review_growth_candidate" }
  | { target_kind: "learning_candidate"; target_id: StableId; command_type: "review_learning_candidate" }
  | { target_kind: "action"; target_id: StableId;
      command_type: "request_action_preview" | "approve_action" | "stop_action" | "report_action_result" };

export type ReviewTargetStatus =
  | "candidate" | "pending_review" | "accepted" | "modified"
  | "rejected" | "held" | "suppressed" | "snoozed" | "completed";
export interface ReviewTargetProjectionBase {
  revision: number;
  title: string;
  summary: string;
  status: ReviewTargetStatus;
  source_ids: StableId[];
  evidence_ids: StableId[];
  teacher_review: TeacherReview;
  external_send: false;
}
export type ReviewTargetProjection =
  | (ReviewTargetProjectionBase & { projection_kind: "observation"; target: Extract<ReviewTargetRef, { target_kind: "observation" }>; collection_ref: StableId | null })
  | (ReviewTargetProjectionBase & { projection_kind: "memory_candidate"; target: Extract<ReviewTargetRef, { target_kind: "memory_candidate" }>; collection_ref: StableId | null })
  | (ReviewTargetProjectionBase & { projection_kind: "task"; target: Extract<ReviewTargetRef, { target_kind: "task" }>; collection_ref: StableId | null })
  | (ReviewTargetProjectionBase & { projection_kind: "teacher_context"; target: Extract<ReviewTargetRef, { target_kind: "teacher_context" }>; field_keys: string[]; value_summary: string; conflict_ids: StableId[] })
  | (ReviewTargetProjectionBase & { projection_kind: "work_candidate"; target: Extract<ReviewTargetRef, { target_kind: "work_candidate" }>; reason: string; snooze_until: string | null; suppression_scope: "this_candidate" | "matching_reason" | "next_cycle" | null; next_cycle_state: string })
  | (ReviewTargetProjectionBase & { projection_kind: "teaching_adjustment"; target: Extract<ReviewTargetRef, { target_kind: "teaching_adjustment" }>; source_hash: string | null; adjustment_summary: string; next_steps: string[] })
  | (ReviewTargetProjectionBase & { projection_kind: "follow_up"; target: Extract<ReviewTargetRef, { target_kind: "follow_up" }>; observed_event_ids: StableId[]; internal_draft_summary: string; permission_state: "not_required" | "permission_required" | "approved" | "blocked" })
  | (ReviewTargetProjectionBase & { projection_kind: "calendar_import"; target: Extract<ReviewTargetRef, { target_kind: "calendar_import" }>; source_hash: string | null; item_count: number; conflict_count: number; held_count: number })
  | (ReviewTargetProjectionBase & { projection_kind: "timetable_import"; target: Extract<ReviewTargetRef, { target_kind: "timetable_import" }>; source_hash: string | null; item_count: number; conflict_count: number; held_count: number })
  | (ReviewTargetProjectionBase & { projection_kind: "material_intake"; target: Extract<ReviewTargetRef, { target_kind: "material_intake" }>; staging_id: StableId | null; source_hash: string | null; expected_size_bytes: number; intake_state: "staged" | "accepted" | "held" | "rejected" })
  | (ReviewTargetProjectionBase & { projection_kind: "insight"; target: Extract<ReviewTargetRef, { target_kind: "insight" }>; insight_summary: string; feedback_effect: string })
  | (ReviewTargetProjectionBase & { projection_kind: "growth_candidate"; target: Extract<ReviewTargetRef, { target_kind: "growth_candidate" }>; artifact_ids: StableId[]; evaluation_ids: StableId[]; growth_state: "candidate" | "approved" | "rejected" | "held" })
  | (ReviewTargetProjectionBase & { projection_kind: "learning_candidate"; target: Extract<ReviewTargetRef, { target_kind: "learning_candidate" }>; independent_evaluation_id: StableId | null; reload_proof_id: StableId | null; route_use_proof_id: StableId | null; rollback_id: StableId | null; activation_state: "pending" | "approved" | "rejected" | "rolled_back" })
  | (ReviewTargetProjectionBase & { projection_kind: "action"; target: Extract<ReviewTargetRef, { target_kind: "action" }>; action_kind: "open_local_file" | "create_teacher_internal_draft" | "update_teacher_internal_task"; execution_owner: ExecutionOwner; action_spec_hash: string; preview_token: StableId; permission_scope: "teacher_internal"; token_state: ActionTokenState; native_execution_id: StableId | null; authorization_expires_at: string | null; action_state: ActionState; receipt_id: StableId | null; rollback_id: StableId | null; desktop_native_attested: DesktopNativeAttestation | null });

export interface ActionStateProjection {
  action_id: StableId;
  action_kind: "open_local_file" | "create_teacher_internal_draft" | "update_teacher_internal_task";
  execution_owner: ExecutionOwner;
  action_spec_hash: string;
  preview_token: StableId;
  permission_scope: "teacher_internal";
  token_state: ActionTokenState;
  native_execution_id: StableId | null;
  authorization_expires_at: string | null;
  state: ActionState;
  expected_snapshot_id: StableId;
  expected_state_hash: string;
  receipt_id: StableId | null;
  rollback_id: StableId | null;
  revision: number;
  teacher_review: TeacherReview;
  desktop_native_attested: DesktopNativeAttestation | null;
  external_send: false;
}

export interface ReceiptSummary {
  receipt_id: StableId;
  command_id: StableId;
  request_id: StableId;
  command_type: CoreCommandType;
  target: ReviewTargetRef | null;
  decision: ReviewDecision | null;
  revision: number;
  status: ReceiptStatus;
  applied_ids: StableId[];
  rejected_ids: StableId[];
  evidence_ids: StableId[];
  before_snapshot_id: StableId;
  after_snapshot_id: StableId | null;
  before_state_hash: string;
  after_state_hash: string | null;
  teacher_review: TeacherReview;
  rollback: {
    available: boolean;
    rollback_id: StableId | null;
    expires_at: string | null;
  };
  external_send: false;
  created_at: string;
}

export interface ReviewHistorySummary {
  review_id: StableId;
  command_id: StableId | null;
  command_type: CoreCommandType;
  target: ReviewTargetRef;
  decision: ReviewDecision;
  revision: number;
  status: ReceiptStatus;
  evidence_ids: StableId[];
  receipt_id: StableId | null;
  before_snapshot_id: StableId;
  after_snapshot_id: StableId | null;
  before_state_hash: string;
  after_state_hash: string | null;
  teacher_review: TeacherReview;
  rollback: {
    available: boolean;
    rollback_id: StableId | null;
    expires_at: string | null;
  };
  external_send: false;
  reviewed_at: string;
}

export interface CoreSnapshot {
  snapshot_id: StableId;
  state_hash: string;
  generated_at: string;
  core_commit: string;
  observations: EducationObservation[];
  memory_candidates: MemoryCandidate[];
  memories: CoreMemory[];
  receipts: ReceiptSummary[]; // maxItems: 100; summaries only, no recursive envelopes
  review_history: ReviewHistorySummary[]; // maxItems: 100
  review_targets: ReviewTargetProjection[]; // maxItems: 200; bounded discriminated projections
  action_states: ActionStateProjection[]; // maxItems: 100; teacher_internal only
  tasks: Array<{
    task_id: StableId;
    title: string;
    status: "candidate" | "pending_review" | "accepted" | "modified"
      | "rejected" | "held" | "completed";
    source_ids: StableId[];
    evidence_ids: StableId[];
    teacher_review: TeacherReview;
    external_send: ExternalSendState;
  }>;
  capabilities: {
    can_review_memory: boolean;
    can_execute_actions: boolean;
    external_send_enabled: false;
    supported_commands: CoreCommandType[];
    supported_projections: ProjectionType[];
  };
}

export type CommandSourceKind =
  | "teacher_message" | "teacher_file" | "core_event"
  | "memory_candidate" | "core_task" | "desktop_native_attested";
export interface CommandSource {
  source_id: StableId;
  source_kind: CommandSourceKind;
  source_hash: string | null;
  evidence_ids: StableId[]; // maxItems: 50
}
export type CommandNote = string; // maxLength: 1000
export interface CalendarImportEvent {
  event_id: StableId;
  date: string; // YYYY-MM-DD
  end_date: string | null;
  name: string; // maxLength: 240
  type: "exam" | "activity" | "meeting" | "holiday"
    | "festival" | "teaching" | "custom";
  confidence: "confirmed" | "teacher_confirmed" | "inferred";
  notes: string | null; // maxLength: 500
}
export interface TimetableImportSlot {
  slot_id: StableId;
  day_of_week: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  period: number; // integer, non-negative
  subject: string; // maxLength: 120
  class_name: string | null; // maxLength: 120
  kind: "class" | "routine";
  notes: string | null; // maxLength: 500
}
export interface MaterialDescriptor {
  material_id: StableId;
  staging_id: StableId | null;
  staging_path: string | null; // validated against desktop staging root
  source_path: string | null; // Core-ingested path, never an arbitrary Desktop path
  source_hash: string; // sha256:
  expected_size_bytes: number; // integer, bounded
  kind: "worksheet" | "lesson_note" | "assessment"
    | "classroom_record" | "other";
  title: string; // maxLength: 240
  subject: string | null;
  class_id: StableId | null;
  source_scope: "desktop_staging" | "core_project_root" | "approved_import";
}

export type CoreCommand =
  | { command_type: "review_observation"; observation_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold";
      patch: { text?: string; subject?: string | null;
        class_id?: StableId | null } | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_memory_candidate"; candidate_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold";
      patch: { proposed_content?: string; tags?: string[] } | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_task"; task_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold" | "rollback";
      rollback_id: StableId | null;
      patch: { title?: string; due_date?: string | null;
        deliverables?: string[] } | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_teacher_context"; context_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold";
      patch: { role?: string; subject?: string; grade?: string;
        class_id?: StableId | null; preferences?: string[] } | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_work_candidate"; candidate_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold" | "snooze" | "suppress";
      patch: { title?: string; summary?: string; due_at?: string | null } | null;
      snooze_until: string | null;
      suppression_scope: "this_candidate" | "matching_reason" | "next_cycle" | null;
      suppression_reason: CommandNote | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_teaching_adjustment"; adjustment_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold";
      patch: { title?: string; summary?: string; next_step?: string } | null;
      source: CommandSource; evidence_ids: StableId[]; note: CommandNote | null }
  | { command_type: "review_follow_up"; follow_up_id: StableId;
      expected_revision: number;
      decision: "accept" | "modify" | "reject" | "hold";
      patch: { title?: string; summary?: string; next_step?: string;
        teacher_internal_scope?: "teacher_internal" } | null;
      source: CommandSource; evidence_ids: StableId[]; note: CommandNote | null }
  | { command_type: "import_calendar"; source: CommandSource;
      events: CalendarImportEvent[] } // maxItems: 200
  | { command_type: "import_timetable"; source: CommandSource;
      slots: TimetableImportSlot[] } // maxItems: 200
  | { command_type: "intake_material"; source: CommandSource;
      material: MaterialDescriptor }
  | { command_type: "review_insight"; insight_id: StableId;
      expected_revision: number;
      decision: "accept" | "reject" | "hold" | "not_useful" | "suppress";
      evidence_ids: StableId[]; feedback_reason: CommandNote | null;
      suppression_scope: "this_insight" | "matching_reason" | "next_cycle" | null;
      suppression_reason: CommandNote | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_growth_candidate"; candidate_id: StableId;
      expected_revision: number;
      decision: "accept" | "reject" | "hold";
      source: CommandSource; note: CommandNote | null }
  | { command_type: "review_learning_candidate"; candidate_id: StableId;
      expected_revision: number;
      decision: "accept" | "reject" | "hold";
      independent_evaluation_id: StableId | null;
      reload_proof_id: StableId | null;
      route_use_proof_id: StableId | null;
      rollback_id: StableId | null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "request_action_preview"; action_id: StableId;
      snapshot_id: StableId;
      action_kind: "open_local_file" | "create_teacher_internal_draft"
        | "update_teacher_internal_task";
      target_id: StableId | null;
      permission_scope: "teacher_internal";
      source: CommandSource; note: CommandNote | null }
  | { command_type: "approve_action"; action_id: StableId;
      preview_token: StableId; action_spec_hash: string;
      execution_owner: ExecutionOwner;
      expected_revision: number;
      expected_snapshot_id: StableId;
      expected_state_hash: string;
      teacher_confirmation: "approve";
      permission_scope: "teacher_internal";
      source: CommandSource; note: CommandNote | null }
  | { command_type: "stop_action"; action_id: StableId;
      action_spec_hash: string; execution_owner: ExecutionOwner;
      expected_revision: number;
      expected_snapshot_id: StableId;
      expected_state_hash: string;
      reason: CommandNote; // repeated envelope idempotency_key is a no-op; never broadens permission
      source: CommandSource; note: CommandNote | null }
  | { command_type: "report_action_result"; phase: "claim";
      action_id: StableId; execution_token: string; action_spec_hash: string;
      execution_owner: "desktop_native"; expected_revision: number;
      expected_snapshot_id: StableId; expected_state_hash: string;
      native_execution_id: StableId; report_hash: string; result: null;
      source: CommandSource; note: CommandNote | null }
  | { command_type: "report_action_result"; phase: "final";
      action_id: StableId; execution_token: string; action_spec_hash: string;
      execution_owner: "desktop_native"; expected_revision: number;
      expected_snapshot_id: StableId; expected_state_hash: string;
      native_execution_id: StableId; report_hash: string;
      result: { status: "completed" | "failed" | "stopped";
        observed_at: string; invocation_command: "open_path";
        target_identity_hash: string; error_code: string | null;
        message: string | null; evidence_ids: StableId[];
        invocation_evidence: DesktopNativeAttestation | null };
      source: CommandSource; note: CommandNote | null };

export interface CommandEnvelope {
  contract_version: ContractVersion | string;
  message_id: StableId;
  request_id: StableId;
  issued_at: string;
  producer: "edupi-desktop";
  schema_hash: string;
  snapshot_id: StableId;
  idempotency_key: StableId;
  provenance: Provenance[];
  teacher_review: TeacherReview;
  external_send: ExternalSendState;
  command: CoreCommand;
}

export interface CoreReceipt {
  receipt_id: StableId;
  command_id: StableId;
  request_id: StableId;
  command_type: CoreCommandType;
  target: ReviewTargetRef | null;
  receipt_phase: ReceiptPhase;
  decision: ReviewDecision | null;
  preview_token: StableId | null;
  status: ReceiptStatus;
  applied_ids: StableId[];
  rejected_ids: StableId[];
  reason_code: ReceiptReasonCode | null;
  evidence_ids: StableId[];
  before_snapshot_id: StableId;
  after_snapshot_id: StableId | null;
  before_state_hash: string;
  after_state_hash: string | null;
  teacher_review: TeacherReview;
  external_send: ExternalSendState;
  rollback: {
    available: boolean;
    rollback_id: StableId | null;
    expires_at: string | null;
  };
  action_authorization: ActionAuthorization | null;
  created_at: string;
}

export type SnapshotEnvelope = BridgeEnvelope<CoreSnapshot>;
export type ReceiptEnvelope = BridgeEnvelope<CoreReceipt>;
~~~

`request_action_preview` accepts no caller-supplied `preview_token`. Core validates the request, generates the preview token, and binds it to action_id, action_spec_hash, execution_owner, Core-resolved target identity, permission scope, expected revision, snapshot/state hash, and TTL. Core returns that token only in the bounded preview projection/preview receipt state; `approve_action` echoes it for exact validation. Core is also the sole generator of the desktop-native `execution_token`, which is returned only in the immediate authorization receipt. ReceiptSummary/ReviewHistorySummary never carry raw preview or execution tokens; action projections carry only bounded token state/identity.

Any legacy observation_id, candidate_id, or task_id fields shown in local presentation examples are derived display fields only; they are not canonical receipt/history discriminators.
`action_authorization.execution_token` is permitted only on the immediate desktop-native authorization CoreReceipt; raw tokens are excluded from ReceiptSummary, ReviewHistorySummary, CoreSnapshot, logs, diagnostics, and evidence files.

The consumer returns a typed unknown_version/unknown_schema/stale_snapshot/invalid_envelope state and renders a recovery message. It never guesses old field names, writes a local fact, or sends externally. v1 requires external_send=false; a command that attempts any other value is rejected.

### Future E4 delivery extension (not part of v1)

The v1 envelope has no external_delivery field and never changes external_send from the JSON boolean false. A real E4 delivery lifecycle is a separately versioned additive contract, introduced only through paired Core producer/Desktop consumer PRs, a schema hash change, compatibility fixtures, and fresh Sol / Max review:

~~~typescript
export interface ExternalDeliveryV2 {
  delivery_contract_version: "2.0";
  state: "permission_required" | "approved" | "sent" | "failed" | "rolled_back";
  channel_type: string;
  conversation_id: string | null;
  inbound_message_id: string | null;
  outbound_message_id: string | null;
  receipt_id: StableId | null;
  evidence_ids: StableId[];
}
~~~

Until that paired review passes, Desktop must disable external delivery controls with a visible unavailable reason rather than overloading v1 external_send.

For intake_material, staging_path is only a validated path under the Desktop staging root and must carry staging_id, source_hash, expected_size_bytes, kind, and source provenance. Core verifies realpath/root/hash/size before atomically ingesting it. A raw arbitrary path, path traversal, unapproved root, or missing hash is rejected before any command is sent.

## Task 0: Reconcile Desktop history and freeze the consumer baseline

Size: S
Depends on: none
Files (read-only):

- docs/EDUPI_DESKTOP_IMPLEMENTATION_PLAN.md
- docs/EDUPI_PRODUCT_MODEL_INTEGRATION.md
- docs/EDUPI_DESKTOP_ACCEPTANCE_MATRIX.md
- docs/EDUPI_WORKSPACE_PRESENTATION_DECISION.md
- docs/THIRD_PARTY_UI_REFERENCES.md

Steps:

1. Compare the immutable C0.1 entry in Core docs/loop/DUAL_SPIRAL_CHECKPOINTS.md and produce the Desktop reconciliation evidence/PR links; do not append or edit the shared ledger. Core Task 0 consumes this evidence and is the sole owner that appends C0.2 with next_entry_point Core Task 1 -> Core Task 2 -> Core Task 3 -> Core Tasks 4A–4D -> Desktop Task 1A -> Desktop Task 1, then remaining foundation.
2. Reconcile prior decisions: one Core truth source, Chat as collaboration layer, task-first content, evidence/review/rollback surface, and the NomiFun/TabTin interaction inspiration without code/brand copying.
3. Run:

~~~sh
git rev-parse HEAD
git status --short
git diff --check
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected: HEAD is ac57d533311968f406a8d53fa3f41c2168530e03; baseline is clean; diff check and existing workbench tests pass.

Acceptance:

- Desktop reconciliation evidence references immutable C0.1 for the authority order, original-workspace warning, first teacher observation input, external_send=false, and paired PR requirement; it does not edit or require new fields in C0.1.
- Core Task 0 appends C0.2 using the Desktop reconciliation evidence, paired PR/commit links, contract status, E0 evidence, rollback, residual risk, and the exact next_entry_point for the first unperformed foundation tasks.
- Historical docs are not treated as already implemented contract behavior.

Rollback: append a corrected ledger note; no source rollback.
Suggested commit: docs(plan): freeze Desktop dual-spiral consumer baseline

## Task 1A: Implement the fixed Core process client

Size: M
Depends on: Task 0 and Core Task 4D
Files (maximum five):

- lib/edupi-core-process-client.ts (new)
- lib/edupi-core-root.ts (new)
- lib/edupi-core-process-client.test.mjs (new)
- lib/edupi-core-root.test.mjs (new)
- scripts/test-edupi-core-process-client.mjs (new)

Steps:

1. Add failing tests for fixed process.execPath invocation, exact desktop_bridge_port.mjs path, shell:false, independently realpath-validated root/cwd/entry, exact cwd equality, regular-file and containment checks, exact Core-owned component-manifest path/hash/size coverage, missing/stale/malformed manifest, wrong core_commit, duplicate/unknown/missing entries, entrypoint/limits omission, safe in-root entry, root symlink normalization, cwd mismatch, directory entry, missing/unreadable entry, manifest hash mismatch, and a malicious scripts/desktop_bridge_port.mjs symlink to a valid external .mjs file proving no child launch. Retain health/snapshot/command, malformed/extra frames, wrong identity/hash, request >256 KiB, stdout >2 MiB, stderr >64 KiB, 5-second health/snapshot timeout, 15-second command timeout, abort/kill, and idempotent retry tests.
2. Run:

~~~sh
node --test lib/edupi-core-process-client.test.mjs lib/edupi-core-root.test.mjs
node scripts/test-edupi-core-process-client.mjs
~~~

Expected before implementation: FAIL because the fixed process client/root validator does not exist.

3. Implement only the bounded child-process client. In development, independently verify repository HEAD equals top-level `core_runtime.core_commit`. Before spawn, read and verify the exact Core-owned `contracts/edupi-desktop-component-manifest.json` from the validated root; reject missing, stale, malformed, wrong runtime commit, duplicate/unknown/missing file entries, entrypoint/limits path/hash/size mismatch, or guessed/local manifest data. Resolve/realpath the configured Core root inside an allowed root, resolve cwd independently and require exact equality, construct only the constant fixed script path, resolve its realpath, require a contained regular file and manifest-covered path/bytes hash, reject escaping symlinks before spawn, invoke process.execPath with the validated entry realpath and `shell:false`/cwd=root, pass only allowlisted non-secret environment values, and parse exactly one response envelope.
4. Return structured unavailable/timeout/oversized/identity errors; do not dynamic-import Core, use a shell/network fallback, or retry mutation with a new idempotency key.
5. Run:

~~~sh
node --test lib/edupi-core-process-client.test.mjs lib/edupi-core-root.test.mjs
node scripts/test-edupi-core-process-client.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; all limit, identity, abort, strict-frame, redaction, and fixed-invocation cases pass.

Acceptance: The Desktop server has one production bridge transport and no arbitrary Core import. This is a C1 foundation substep; it remains in_progress or evidence_pending until C1 passes.

Rollback: disable the client and expose read-only unavailable state; never add a dynamic import, network daemon, or shell fallback.
Suggested commit: feat(desktop): invoke Core through fixed bounded process bridge

## Task 1: Pin Core commit/schema and fail closed on unknown bridge versions

Size: M
Depends on: Task 0, Task 1A, and Core Task 3
Files (maximum five):

- lib/edupi-bridge-contract.ts (new)
- lib/edupi-bridge-manifest.ts (new)
- lib/edupi-bridge-consumer.ts (new)
- contracts/edupi-core-compat.json (new)
- lib/edupi-bridge-contract.test.mjs (new)

Behavior: a snapshot/receipt is projected only when contract_version, schema_hash, producer, required IDs, provenance, teacher_review, and external_send match the pinned manifest. The same task establishes exactly one top-level `core_runtime` identity and rejects unknown/multiple identities, development HEAD mismatch, component-manifest path/hash/closure mismatch, or contract/runtime incompatibility before projection or command routing.

Steps:

1. Add failing tests for a valid v1 snapshot, all 17 bounded command shapes, every ReviewTargetRef mapping, every bounded review_targets/action_states projection variant, bounded receipts/review_history target consistency with stable IDs and before/after hashes, the complete command-to-decision pairing matrix, modify/snooze/suppress/not_useful/approve/stop decision round-trip, all four action commands including claim/final report_action_result, caller-supplied preview_token rejection, Core-generated preview-token binding/replay, issued -> invalidated pre-claim stop, claim rejection after invalidation, and the exact token exception: a synthetic raw execution_token is allowed only in the immediate desktop-native authorization CoreReceipt.action_authorization and is rejected from preview/claim/result/mutation/stop receipts, ReceiptSummary, ReviewHistorySummary, CoreSnapshot/action projections, logs, diagnostics, fixtures, and evidence snapshots. Cover exact replay versus changed replay, stale/forged/expired reports, stop races, crash/lost-report outcome_unknown, invalid decision/phase-for-command rejection, unknown version, unknown schema hash, missing provenance, malformed review, external_send mismatch, stale snapshot, and an initial manifest with supported_commands: [] and supported_projections: [].
2. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
~~~

Expected before implementation: FAIL because the manifest/consumer does not exist.

3. Implement the manifest and parser. Use the exact Core commit/schema hash supplied by the paired Core PR; do not infer it from local file names. Return a discriminated error for unknown_version, unknown_schema_hash, invalid_envelope, stale_snapshot, and unsupported_command. Validate bounded patches, arrays, source_scope, material hashes, receipt summaries, and review_history summaries before any command is sent.
4. Ensure the consumer has no write or send side effect. It returns a typed projection only after validation.
5. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
~~~

Expected: PASS; unknown versions produce no projection/write call and expose a refresh/update recovery state.

Acceptance:

- contracts/edupi-core-compat.json pins top-level `core_runtime.core_commit` plus `component_manifest_path`/`component_manifest_hash`, contract_version/schema_hash/fixture_manifest_hash, supported commands, and paired PR/change note.
- Unknown contract versions fail closed.
- external_send is the JSON boolean false; local C1 values remain false and external_delivery is absent in v1.
- No credentials, raw chain of thought, or private Core paths are exposed.
- Initial supported_commands is empty; only the post-Core-Tasks-5–7 paired update may enable review_observation and review_memory_candidate.
- Task 1 contract tests validate all 17 command shapes, ReviewTargetRef mappings, later review_targets/action_states projections, the exact command-to-decision pairing matrix, typed receipt/history targets, all four action phases/commands, caller-supplied preview-token rejection, Core-generated preview-token binding/replay, issued -> invalidated stop/claim rejection, and token redaction/replay/stop-race behavior; mismatched command_type/target_kind/target_id/decision/phase fails closed.
- This is a C1 foundation substep; keep its ledger status in_progress or evidence_pending until the complete C1 loop passes.

Rollback: restore the previous manifest only if it points to a still-supported producer; otherwise disable the feature and show read-only unavailable state. Never loosen validation to make a mismatched producer pass.
Suggested commit: feat(desktop): pin and validate EduPi bridge v1

## Task 2: Split projection from commands around education contract functions

Size: M
Depends on: Task 1
Files (maximum five):

- lib/edupi-education-contract.ts
- lib/edupi-education-server.ts
- app/api/edupi/education/route.ts
- lib/edupi-education-server.test.mjs (new)

Goal: make buildEducationContract a pure projection mapper and readEducationContract a read-only adapter over lib/edupi-core-process-client.ts while command writes move behind a typed Core command boundary. The builder may map only Core-provided tasks, candidates, observations, and facts; Desktop policy synthesis is forbidden.

Steps:

1. Add failing tests that stub a validated Core snapshot and assert buildEducationContract maps it without reading/writing local JSON. Add cases with raw student/material memory but no Core task/candidate and assert no production task is synthesized. Add a test that readEducationContract invokes the fixed Core process client and fails closed on unknown version, missing project root, timeout, or unsupported command.
2. Run:

~~~sh
node --test lib/edupi-education-server.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL because the current server reads local files and command paths are interwoven.

3. Refactor only the projection boundary: keep existing normalized EducationContract output where possible, add source snapshot_id/schema_hash/evidence/review/receipt metadata, and remove direct write responsibility from the read path. Route reads through the fixed process client; do not read Core JSON directly from the Desktop server. Remove generatedStudentEvents, generatedTeachingMaterials, generated material-candidate tasks, or equivalent production synthesis from buildEducationContract; if migration coverage needs them, quarantine them as test-only adapters that production code cannot import.
4. Preserve existing route response shapes only through an explicit compatibility adapter. Do not make a local JSON fallback for a failed Core read.
5. Run:

~~~sh
node --test lib/edupi-education-server.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; projection tests are deterministic, existing workbench tests remain green, and read errors are visible rather than silently empty.

Acceptance:

- readEducationContract/buildEducationContract no longer conceal a second truth source.
- readEducationContract uses the fixed Core process client; it has no direct Core JSON read or dynamic import.
- buildEducationContract maps only Core-provided tasks/candidates/facts; generatedStudentEvents, generatedTeachingMaterials, and material-candidate synthesis are absent from production output.
- Projection can show candidate-only, pending review, evidence, external_send, and receipt state.
- Task-session binding remains compatible and still validates project root/session ownership.
- Import/review command paths are explicitly marked for the paired foundation migration tasks rather than accidentally left as direct writes.
- This is a C1 foundation substep; keep its ledger status in_progress or evidence_pending until the complete C1 loop passes.

Rollback: revert the projection split while keeping the failing tests as a guard; do not delete current task/session data.
Suggested commit: refactor(desktop): separate Core projection from education writes

## Task 2A: Migrate legacy status projection to the validated Core bridge

Size: M
Depends on: Task 1A and Task 2
Files (maximum five):

- app/api/edupi/status/route.ts
- components/EduPiWorkspace.tsx
- components/AppShell.tsx
- app/api/edupi/status/route.test.mjs (new)
- components/EduPiWorkbench.test.mjs

Behavior: the legacy status surface and its live AppShell/admin caller use only the validated health/snapshot envelopes from `lib/edupi-core-process-client.ts`, or are visibly retired/read-only when the capability is unavailable. They never read Core preferences, student, timetable, calendar, rhythm, or other `.edupi` JSON directly and never synthesize status from Desktop state.

Steps:

1. Add failing route/workspace tests that detect direct Core JSON reads, exercise unknown-version/schema/timeout/unavailable health, and assert the visible unavailable/read-only reason plus no local fallback.
2. Run:

~~~sh
node --test app/api/edupi/status/route.test.mjs components/EduPiWorkbench.test.mjs
~~~

Expected before implementation: FAIL because the status route/workspace reads legacy Core JSON and the live AppShell/admin path can reach it.
3. Replace the direct reads with the fixed process client health/snapshot projection, validate contract/schema/hash, and retire any status card/control whose data cannot be proven through the envelope. Preserve only bounded process/channel/conversation/receipt labels and never expose raw private facts.
4. Run:

~~~sh
node --test app/api/edupi/status/route.test.mjs components/EduPiWorkbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; status is envelope-backed or visibly unavailable, and no legacy Core JSON path is reachable from AppShell/admin.
5. Commit the route/workspace migration as a paired C1 foundation change before deeper command/page work.

Acceptance: Phase 1 cannot exit while app/api/edupi/status/route.ts or components/EduPiWorkspace.tsx can directly read Core preferences/student/timetable/calendar/rhythm JSON. The route either projects validated Core health/snapshot state or fails closed/read-only with a reason; it does not create a second status truth source.
Rollback: disable the legacy status surface and show the explicit unavailable reason while retaining the validated bridge tests; never restore direct JSON reads.
Suggested commit: refactor(desktop): migrate legacy status projection to Core bridge

## Task 3: Issue typed command envelopes and consume Core receipts

Size: M
Depends on: Task 2, Task 2A, Core Task 4A, Core Task 4B, Core Task 4C, Core Task 4D, Core Task 6, and Core Task 7
Files (maximum five):

- lib/edupi-bridge-command-client.ts (new)
- app/api/edupi/commands/route.ts (new)
- lib/edupi-bridge-command-client.test.mjs (new)
- components/EduPiReviewTaskCard.tsx
- components/EduPiInspector.tsx

Behavior: review controls create a CommandEnvelope with the pinned contract version, snapshot_id, idempotency_key, provenance/evidence, teacher review, and JSON boolean external_send=false. The route forwards it to Core and returns a ReceiptEnvelope; it never writes local education JSON. The v1 client rejects any non-false external_send value and has no external_delivery field.

Scope: Task 3 wires only review_observation and review_memory_candidate for C1. The schema-defined review_task, import_calendar, import_timetable, intake_material, and request_action_preview variants remain visibly unsupported until their paired Core handlers/fixtures and manifest updates land. Legacy task review is owned by Task 3D.

Steps:

1. Add failing tests for accept, modify, reject, hold, stale snapshot, duplicate idempotency key, unknown Core response, and non-false external_send rejection.
2. Run:

~~~sh
node --test lib/edupi-bridge-command-client.test.mjs
~~~

Expected before implementation: FAIL because the typed command client/route does not exist and review buttons still call local write paths.

3. Implement bounded command builders and route validation. Use request security and existing API conventions; reject unknown command types, arbitrary file paths, external audiences, and malformed IDs.
4. Update review/inspector controls to display receipt status, reason, evidence IDs, rollback availability, and refresh affordance. Do not expose raw model reasoning.
5. Run:

~~~sh
node --test lib/edupi-bridge-command-client.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; accepted/rejected/stale receipts are rendered, unknown responses fail closed, and no direct JSON write is reachable from these controls.

Acceptance:

- Core is the only writer for review decisions.
- A receipt is required before the UI reports success.
- external_send is the JSON boolean false and remains visible.
- Rollback and stale snapshot states are actionable but cannot bypass Core.
- This is a C1 foundation substep; keep its ledger status in_progress or evidence_pending until the complete C1 loop passes.

Rollback: disable command controls and leave projection read-only; revert the command route without deleting receipts.
Suggested commit: feat(desktop): send reviewed-memory commands and display Core receipts

## Task 3A: Migrate calendar, timetable, and material mutation paths

Size: M
Depends on: Task 3, Core Task 3, Core Task 4A, Core Task 4B, Core Task 4C, and Core Task 4D
Files (maximum five):

- app/api/edupi/education/route.ts
- components/EduPiCalendarModule.tsx
- components/EduPiRhythmImporter.tsx
- components/EduPiMaterialModule.tsx
- components/EduPiWorkbench.test.mjs

Behavior: calendar import, timetable import, and education material intake either issue import_calendar, import_timetable, or intake_material CommandEnvelope values and wait for a Core ReceiptEnvelope, or expose a visible unavailable/read-only reason. intake_material carries staging_id/staging_path scoped to desktop_staging, expected_size_bytes, source_hash, bounded kind/title, and source provenance. No production route may write calendar.json, timetable.json, material_candidates.json, or any memory JSON.

Steps:

1. Add failing tests that stub each import/review route and assert a typed Core command, JSON boolean external_send=false, receipt-required success, and no local write. Add a case where Core reports unsupported command and assert disabled controls with the reason.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
~~~

Expected before implementation: FAIL because current import paths can write local JSON directly or bypass the bridge.

3. Replace direct writes with the command client. Preserve form bounds and source/hash validation. If Core command semantics are not ready, return read-only projection plus explicit unavailable state; do not leave a silent gap.
4. Refresh only from a validated Core snapshot after a receipt.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; every targeted calendar/timetable/material mutation path is Core-command-backed or visibly disabled, and no direct JSON writer remains reachable for those paths.

Acceptance: This is a C1 foundation substep and remains in_progress or evidence_pending until C1 passes. Phase 1 cannot exit with a partial migration.

Rollback: disable the affected mutation controls and retain read-only projection; never restore a Desktop JSON fallback.
Suggested commit: refactor(desktop): route calendar timetable and material writes through Core

## Task 3B: Establish Desktop-owned task-session UI state

Size: M
Depends on: Task 2
Files (maximum four):

- lib/edupi-desktop-state-server.ts (new)
- lib/edupi-desktop-state-server.test.mjs (new)
- src-tauri/src/lib.rs
- scripts/desktop-dev.mjs

Behavior: task-session binding is UI integration state, not Core education truth. Persist only task_id, session_id, bound_at, and ui_status (running, idle, missing) as atomic 0600 JSON with a lock under PI_DESKTOP_STATE_DIR. Tauri computes app_config_dir and passes it to the packaged server through the launch path; web/dev uses the explicit ~/.pi/agent/desktop-state fallback. APP_PREF_KEYS/getPref/setPref are not used because they are server no-ops.

Steps:

1. Add failing tests for bind, rebind, invalid IDs, duplicate session ownership, restart load, missing session status, rejection of an education fact field, atomic 0600 permissions, lock contention, PI_DESKTOP_STATE_DIR resolution, and Tauri/dev path selection.
2. Run:

~~~sh
node --test lib/edupi-desktop-state-server.test.mjs
~~~

Expected before implementation: FAIL because the server-owned state adapter and launch-path environment do not exist.

3. Implement the smallest server state adapter with atomic temp-file/rename, 0600 mode, lock, bounded schema, and explicit state root. Keep task/session IDs opaque; do not store task title, evidence, memory, teacher decision, or Core JSON.
4. Pass Tauri app_config_dir as PI_DESKTOP_STATE_DIR to the packaged server and define web/dev fallback ~/.pi/agent/desktop-state. Add a migration marker/version for Task 3C without creating a localStorage path.
5. Run:

~~~sh
node --test lib/edupi-desktop-state-server.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; state round-trips across server restart, has 0600 permissions/lock behavior, resolves the documented path, and contains only the four UI fields.

Acceptance: This is a C1 foundation substep and remains in_progress or evidence_pending until C1 passes. Core snapshots never include this state.

Rollback: stop reading the server state and return to an explicit binding-unavailable state; retain the legacy file for a later reviewed migration.
Suggested commit: feat(desktop): persist task session bindings in server-owned state

## Task 3C: Migrate task-session callers off Core .edupi output

Size: M
Depends on: Task 3B
Files (maximum five):

- lib/edupi-education-server.ts
- app/api/edupi/tasks/[taskId]/session/route.ts
- components/EduPiEducationPanel.tsx
- lib/edupi-task-session-store.ts
- lib/edupi-task-session-store.test.mjs

Behavior: remove the production read/write dependency on .edupi/output/task_session_bindings.json. On first load only, validate and migrate task_id/session_id/bound_at records into lib/edupi-desktop-state-server.ts. Thereafter, the Desktop API/server derives running/idle/missing from current Pi session state; Core snapshots remain education-only.

Steps:

1. Add failing tests that prove the server projection does not load task_session_bindings.json as Core data, one-time migration preserves valid IDs/restart recovery, invalid/duplicate records are rejected without overwrite, and the legacy writer has no production caller.
2. Run:

~~~sh
node --test lib/edupi-task-session-store.test.mjs lib/edupi-desktop-state-server.test.mjs
~~~

Expected before implementation: FAIL because readEducationContract currently reads the Core output binding file and bindEducationTaskSession writes it.

3. Move binding ownership to lib/edupi-desktop-state-server.ts. Keep lib/edupi-task-session-store.ts only as a bounded migration reader/test adapter or remove it after the paired callers are gone; do not delete the legacy file automatically.
4. Update the Desktop API route and panel to return/use server-owned state, preserving task/session IDs and fork validation. The server validates task/session/project ownership before binding or rebind. Never add education facts to the state.
5. Run:

~~~sh
node --test lib/edupi-task-session-store.test.mjs lib/edupi-desktop-state-server.test.mjs
node --test lib/edupi-workbench.test.mjs components/EduPiWorkbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; restart recovery works, Core projection no longer treats bindings as education data, and no production route writes .edupi/output/task_session_bindings.json.

Acceptance: This is a C1 foundation substep and remains in_progress or evidence_pending until C1 passes. The migration is reversible and leaves the legacy file untouched.

Rollback: restore the UI-only state adapter and show binding-unavailable/read-only status; never re-enable a direct Core output writer as a silent fallback.
Suggested commit: refactor(desktop): move task session binding out of Core truth

## Task 3D: Migrate legacy task review to review_task or visible read-only

Size: M
Depends on: Task 3 and Task 3C
Files (maximum five):

- lib/edupi-education-server.ts
- app/api/edupi/education/route.ts
- components/EduPiEducationPanel.tsx
- components/EduPiWorkbench.test.mjs
- lib/edupi-bridge-command-client.test.mjs

Behavior: the existing accept/modify/reject/hold/rollback task-review path must issue the bounded review_task CommandEnvelope and consume a Core ReceiptEnvelope when a paired handler is eventually proven. Task 3D deliberately closes the direct writer immediately: until the dedicated paired Core review_task bridge handler, fixtures, manifest update, schema hash, and PR review are proven, the controls are visibly disabled/read-only with the Core or manifest reason. No direct teacher_task_review.mjs import, dynamic import, or direct Core JSON write remains reachable after Phase 1.

Steps:

1. Add failing tests that inspect the production route/server/panel path for reviewTeacherTask or teacher_task_review.mjs reachability, assert bounded review_task command fields (task_id, expected_revision, decision, rollback_id, patch, source, note), and cover unsupported-command read-only behavior.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-bridge-command-client.test.mjs
~~~

Expected before implementation: FAIL because the current server can load teacher_task_review.mjs and mutate rhythm/task JSON directly.

3. Remove the production import/write path and route task review through the command client. Preserve the visible task/review history as Core projection. If review_task is absent from supported_commands, render the disabled reason and do not POST a guessed command.
4. After the paired Core handler is proven, add receipt-backed accept/modify/reject/hold/rollback controls and refresh from the new snapshot. Until then, keep the controls visibly read-only. Keep the legacy file only as historical data; do not silently migrate or overwrite it from Desktop.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-bridge-command-client.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; no production task-review path can reach teacher_task_review.mjs or a direct Core JSON writer, and unsupported review_task is visibly read-only until paired support lands.

Acceptance: This is a C1 foundation substep and remains in_progress or evidence_pending until C1 passes. Phase 1 cannot exit while the legacy mutation path is reachable, even if other bridge fixtures pass; it may exit with task-review visibly read-only while the dedicated Core handler is unsupported.

Rollback: keep task review read-only with the explicit unavailable reason; never restore the direct teacher_task_review.mjs import as a silent fallback.
Suggested commit: refactor(desktop): migrate legacy task review to Core receipts

## Task 3E: Reserve Core paths in the generic Desktop file writer

Size: S
Depends on: Task 0
Files (exactly five):

- app/api/files/[...path]/route.ts
- app/api/desktop/save/route.ts
- lib/file-access.ts
- lib/file-upload.test.mjs
- app/api/files/reserved-paths.test.mjs (new)

Behavior: Desktop product mutation routes, including native-dialog app/api/desktop/save/route.ts, reject writes to Core-reserved .edupi/memory, .edupi/output, and .edupi/inbox paths. Existing allowlisted read-only access/open/reveal may remain. The routes retain desktop token/request security and return a visible structured reserved-path reason; they do not infer whether a write is “safe”.

Steps:

1. Add failing tests for direct writes to each reserved path, app/api/desktop/save/route.ts native save, realpath/symlink escapes, traversal/encoded traversal, read-only/open/reveal access, unrelated allowed project files, desktop token/request security, and the staging route exception.
2. Run:

~~~sh
node --test lib/file-upload.test.mjs app/api/files/reserved-paths.test.mjs
~~~

Expected before implementation: FAIL because the generic writer can reach Core-reserved paths.

3. Add the narrow reserved-root guard at both generic and native-save route boundaries; realpath-resolve the destination, reject symlink/encoded traversal, preserve existing source/destination allowlists and desktop token/request security.
4. Run:

~~~sh
node --test lib/file-upload.test.mjs app/api/files/reserved-paths.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; reads remain possible where allowed, writes are rejected with a visible reason, and staging is the only approved material mutation flow.

Acceptance: This closes a production write escape before Phase 1; it is a C1 foundation substep and remains in_progress or evidence_pending until C1 passes.

Rollback: retain the guard and disable affected write controls; never remove the reserved-path test to restore a direct writer.
Suggested commit: security(desktop): reserve Core memory output and inbox paths

## Task 3F: Migrate onboarding context to a Core command

Size: M
Depends on: Task 1 and Task 3
Files (maximum four):

- lib/edupi-onboarding-server.ts
- app/api/edupi/onboarding/route.ts
- lib/edupi-bridge-command-client.ts
- app/api/edupi/onboarding/route.test.mjs (new)

Behavior: both reachable onboarding directions are closed: GET loadTeacherContext no longer reads raw Core preferences (or student/context JSON) and instead projects teacher context from a validated Core snapshot envelope; POST saveTeacherContext no longer writes preferences.json and instead issues the later review_teacher_context command/receipt or visibly disables setup mutation when that capability is absent. There is no raw-file fallback in either direction.

Steps:

1. Add failing tests for a raw-read spy/no-file-access GET, valid projected context, unavailable or malformed Core snapshot, GET/POST capability mismatch, context proposal accept/modify/reject/hold, missing Core capability, and any attempted secret/provider field.
2. Run:

~~~sh
node --test app/api/edupi/onboarding/route.test.mjs
~~~

Expected before implementation: FAIL because loadTeacherContext currently reads raw Core preferences and saveTeacherContext writes Core preferences directly.

3. Route GET through the validated Core health/snapshot projection and reject unknown/malformed envelopes without fallback. Route POST through the paired Core contract command with bounded teacher role/subject/grade/class/preferences fields and receipt. Keep provider credentials outside the command.
4. Return a visible unavailable/read-only reason for either direction when the required Core capability/envelope is absent; never read/write preferences.json, student files, or other `.edupi` files from this route/server.
5. Run:

~~~sh
node --test app/api/edupi/onboarding/route.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; no Desktop onboarding raw read or preferences.json write remains, GET/POST capability mismatches fail closed, and unsupported onboarding mutation/projection is visible.

Acceptance: C2 cannot claim complete until its paired contract/fixture/manifest task and this migration pass; Phase 1 cannot exit while either onboarding GET raw-read or POST direct-write path remains reachable.

Rollback: make onboarding read-only/Chat-guided and preserve Core history; never restore saveTeacherContext direct writes.
Suggested commit: refactor(desktop): route teacher context through Core review receipt

## Task 3G: Create the Desktop-owned material staging service

Size: M
Depends on: Task 3E and Task 3B
Files (maximum three):

- lib/edupi-material-staging.ts (new)
- app/api/edupi/materials/staging/route.ts (new)
- lib/edupi-material-staging.test.mjs (new)

Behavior: uploads land outside Core .edupi under join(PI_DESKTOP_STATE_DIR, material-staging). The service validates root, file type, count, size, and name; writes 0600; generates staging_id; computes SHA-256; and returns only a bounded staging descriptor.

Steps:

1. Add failing tests for allowed file, disallowed extension, count/size limits, traversal, wrong root, 0600 mode, hash, generated ID, cleanup after accepted receipt, and retained failed staging.
2. Run:

~~~sh
node --test lib/edupi-material-staging.test.mjs
~~~

Expected before implementation: FAIL because the staging service/route does not exist.

3. Implement staging under the server state root only. The route must never accept a caller-supplied destination outside that root and must not write Core memory/output/inbox.
4. Run:

~~~sh
node --test lib/edupi-material-staging.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; staging descriptors contain staging_id, staging_path, expected_size_bytes, source_hash, kind, and source_scope=desktop_staging.

Acceptance: Intake can later send a bounded staging descriptor to Core; failed staging is visible/auditable and cleanup is explicit.

Rollback: retain failed staging for audit or explicit teacher cleanup; disable upload controls rather than writing Core paths directly.
Suggested commit: feat(desktop): stage teacher materials outside Core truth

## Task 3H: Migrate every reachable teacher-material upload path

Size: M
Depends on: Task 3E, Task 3G, and Task 3A
Files (maximum five):

- components/EduPiEducationPanel.tsx
- components/EduPiEducationHome.tsx
- components/FileExplorer.tsx
- components/SessionSidebar.tsx
- components/EduPiWorkbench.test.mjs

Behavior: uploadMaterials, the legacy EducationHome upload, FileExplorer teacher-material targets, and SessionSidebar teacher-material targets all use the staging route and later intake_material receipt, or are visibly disabled. None may call generic /api/files with a Core .edupi destination.

Steps:

1. Add failing tests that inspect every reachable target path and assert staging route use, no .edupi/inbox destination, bounded descriptor, receipt-required success, and visible unsupported state.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
~~~

Expected before implementation: FAIL because legacy and generic upload paths can write .edupi/inbox/teacher-materials.

3. Replace each production path with staging -> intake_material; preserve read-only file viewing and existing allowlists.
4. Delete staging only after accepted Core receipt or explicit cleanup; retain failed staging/audit state.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; all listed upload entrypoints are staged or visibly disabled and no generic writer reaches Core-reserved paths.

Acceptance: Phase 1 write inventory is closed for material uploads; this remains in_progress/evidence_pending until C1 passes.

Rollback: disable all material mutation controls and retain read-only projection/staging records; never restore a direct inbox writer.
Suggested commit: refactor(desktop): route all teacher material uploads through staging

## Task 4: Copy and pin paired bridge fixtures

Size: S
Depends on: Task 1A, Task 1, Task 3A, Task 3B, Task 3C, Task 3D, Task 3E, Task 3F, Task 3G, and Task 3H
Files (exactly five):

- fixtures/edupi-bridge/v1/snapshot-observation-memory.json (new)
- fixtures/edupi-bridge/v1/command-review-memory.json (new)
- fixtures/edupi-bridge/v1/receipt-review-memory.json (new)
- fixtures/edupi-bridge/v1/fixture-manifest.json (new)
- contracts/edupi-core-compat.json

Behavior: copy/pin only the snapshot, command, receipt, and fixture-manifest artifacts from the exact paired Core commit. `contracts/edupi-core-compat.json` remains Desktop-owned: update it independently from the verified Core commit, contract/schema hash, fixture-manifest hash, and paired PR/change note. Do not verify or enable capabilities in this copy task.

Steps:

1. Add a failing copy/pin check for all four Core fixture paths and a separate assertion that the Desktop-owned compat manifest records the verified Core identities without being copied from Core.
2. Run:

~~~sh
test -s fixtures/edupi-bridge/v1/snapshot-observation-memory.json
test -s fixtures/edupi-bridge/v1/command-review-memory.json
test -s fixtures/edupi-bridge/v1/receipt-review-memory.json
test -s fixtures/edupi-bridge/v1/fixture-manifest.json
~~~

Expected before implementation: FAIL because the four copied fixtures/manifest are absent or not pinned to the Core commit.

3. Copy only the four non-code fixture artifacts from the pinned Core commit; do not edit them locally or include fixture-manifest.json in its own input list. Independently update contracts/edupi-core-compat.json with the verified identities and keep its Desktop ownership explicit.
4. Record the paired Core PR, raw fixture hashes, fixture_manifest_hash, contract/schema hash, Desktop-owned manifest change note, and consumer PR in the PR description.
5. Run:

~~~sh
test -s fixtures/edupi-bridge/v1/snapshot-observation-memory.json
test -s fixtures/edupi-bridge/v1/command-review-memory.json
test -s fixtures/edupi-bridge/v1/receipt-review-memory.json
test -s fixtures/edupi-bridge/v1/fixture-manifest.json
~~~

Expected: PASS; all four copied artifacts exist at the pinned identity and the separately maintained compat manifest references those verified identities. Semantic verification is Task 4V.

Acceptance: four-file copy/pin is deterministic and v1 external_send is false; this task proves no semantic compatibility and leaves supported_commands empty. It is a C1 foundation substep whose ledger status remains in_progress or evidence_pending.

Rollback: revert the manifest/fixture update and block bridge consumers until paired PRs are aligned.
Suggested commit: chore(bridge): pin Core fixture artifacts

## Task 4V: Verify copied fixtures and fixture-manifest hash

Size: S
Depends on: Task 4, Core Task 4A, Core Task 4B, and Core Task 4C
Files (maximum three):

- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- scripts/test_fixture_manifest_copy.mjs (new)

Behavior: re-hash the four copied artifacts, verify fixture-manifest.json excludes itself and contains algorithm/files/fixture_manifest_hash, compare snapshot/command/receipt semantics, and verify contracts/edupi-core-compat.json pins the same Core/schema/fixture identities.

Steps:

1. Add failing tests for missing command/receipt/manifest copy, raw hash drift, self-inclusion, canonical-entry drift, unknown version, recursive envelope, and unsupported capability.
2. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
node scripts/test_fixture_manifest_copy.mjs
~~~

Expected before implementation: FAIL on stale/missing copy or hash mismatch.

3. Implement only the deterministic verifier; do not weaken schema or auto-copy on mismatch.
4. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
node scripts/test_fixture_manifest_copy.mjs
npm run lint
~~~

Expected: PASS with four raw fixture hashes, canonical entries hash, compat hash, and no capability enablement.
5. Commit after paired Core/Desktop review.

Acceptance: E1 copied-fixture compatibility is proven; supported_commands remains empty until Task 4E.
Rollback: block consumers and revert the pin/copy commit; preserve mismatch evidence.
Suggested commit: test(bridge): verify pinned fixture copy and manifest hash

## Task 4E: Enable exactly the proven C1 runtime capabilities

Size: M
Depends on: Task 4V and Core Task 7E
Files (maximum five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/snapshot-observation-memory.json
- fixtures/edupi-bridge/v1/receipt-review-memory.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs

Behavior: update the initially empty supported_commands manifest only after Core Task 7E proves the fixed-port handlers, snapshot, receipt, history summaries, and fresh component manifest. Independently update top-level `core_runtime.core_commit` + `component_manifest_hash` from the paired Core PR. The post-enable manifest contains exactly review_observation and review_memory_candidate; no other command is enabled.

Steps:

1. Add failing tests for an empty initial manifest, Core capability response with exactly two names, pinned Core commit/schema/fixture hashes, and rejection of review_task/import/action names.
2. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
~~~

Expected before implementation: FAIL because the manifest must not enable C1 until Core Task 7E proof is present.

3. Update the manifest and pinned fixtures/hash only from the paired Core Task 7E PR. Preserve unsupported reasons for every other command.
4. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; supported_commands contains exactly the two C1 review commands and no unsupported command can be routed.

Acceptance: This is the legal C1 capability enablement substep. Task 5 and Task 5E2 may depend on it, but C1 remains evidence_pending until the mandatory E2 gate passes.

Rollback: restore supported_commands: [] and the previous pinned manifest/hash; leave all review controls visibly read-only.
Suggested commit: feat(desktop): enable only proven C1 bridge capabilities

## Task 5: Ship the C1 observation/memory review surface

Size: M
Depends on: Task 2, Task 3, Task 3A, Task 3B, Task 3C, Task 3D, Task 3E, Task 3F, Task 3G, Task 3H, Task 4, Task 4E, and Core Task 8
Files (maximum five):

- components/EduPiEducationPanel.tsx
- components/EduPiWorkspaceViews.tsx
- components/EduPiReviewTaskCard.tsx
- components/EduPiInspector.tsx
- components/EduPiWorkbench.test.mjs

Behavior: the first teacher observation appears in Today/Memory as candidate-only and pending review. The teacher can accept, modify, reject, or hold; the UI sends a typed command, waits for a receipt, refreshes the validated snapshot, and shows the next state.

Task 5 never optimistically calls a command absent from supported_commands. Its C1 review controls are enabled only when the paired Core Tasks 5–7 proof and Desktop Task 4E manifest update have passed; otherwise they remain visibly disabled/read-only with the capability reason.

The refreshed snapshot must show bounded receipt and review_history summaries with stable IDs, decision/revision/status, evidence IDs, before/after snapshot IDs and state hashes, bounded teacher_review/rollback state, and external_send=false; it must not recursively embed full envelopes.

Steps:

1. Add failing component/workbench tests for candidate-only observation, provenance/evidence display, each four review decisions, rejected-not-memory, receipt refresh, stale snapshot, and external_send=false.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL because the workbench does not project observation/memory candidates or route decisions through the new command client.

3. Implement the smallest content-first review surface using existing workbench and inspector patterns. Show concise evidence and uncertainty; do not show raw chain of thought. Keep Chat as the input and task/session continuation surface.
4. Wire each control to Task 3's command client. Disable controls while a request is pending, show receipt/reason/rollback state, and re-fetch the snapshot after a successful receipt.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; all decisions are visible and receipt-backed, rejected material is not displayed as a fact, and refresh/replay leaves the correct state.

Acceptance:

- C1 visible loop is complete without a local education write.
- The UI answers what needs confirmation, why, what Core remembered, and how the receipt changed it.
- Existing Pi Chat/session behavior remains intact.
- Visual changes are scoped to this slice; no standalone redesign phase.
- This is the first Desktop task that can contribute to the first passed product checkpoint; foundation Tasks 1A–4 and 3A–3H remain in_progress or evidence_pending until this seven-step loop, the shared Task 5E2 E2 verifier, and restart/replay pass.

Rollback: hide the new review section and leave the read-only projection; preserve Core receipts and candidate state.
Suggested commit: feat(desktop): review Core teacher observations and memory candidates

## Task 5E2: Run the mandatory shared C1 E2 verifier

Size: M
Depends on: Core Task 8, Task 5, and Task 4E
Files (maximum five):

- scripts/verify-edupi-c1-e2.mjs (new)
- scripts/edupi-c1-e2-harness.mjs (new)
- scripts/verify-edupi-c1-e2.test.mjs (new)
- package.json
- Core: docs/loop/DUAL_SPIRAL_CHECKPOINTS.md

Behavior: one cross-repository orchestrator proves the same C1 IDs across the real local Pi Chat/session observation path, fixed Core child bridge, Desktop API/process client, review command, receipt/refreshed projection, bounded receipts/review_history summaries, and restart/replay. It uses a deterministic local provider/adapter and remains E2, not E3.

Task 5E2 is the sole owner of the final cross-repository C1 E2 evidence artifact and append-only ledger status decision. Core Task 8 supplies Core-only persistence evidence and cannot mark C1 passed.

Steps:

1. Add failing tests for isolated Core/Desktop temp state roots, deterministic observation input, candidate through the production child bridge, review through the real Desktop API/process client, accepted/modified/rejected/held decisions, receipt/state hashes, restart, mismatched IDs, missing receipt, and unavailable provider/paired worktree.
2. Run:

~~~sh
EDUPI_CORE_ROOT=<paired-worktree> npm run test:edupi-c1-e2
~~~

Expected before implementation: FAIL because the shared orchestrator is absent or cannot tie the production boundaries together.

3. Add the package script test:edupi-c1-e2 and implement the harness with isolated temporary state directories, deterministic local test provider/adapter, bounded API/process calls, redacted evidence output, and no external send. It must use the fixed Core child bridge and actual Desktop API/process client, not fixture-only imports.
4. Restart the Core child/runtime and verify accepted, modified, rejected, and held state hashes and candidate/fact visibility using the same IDs.
5. With the Core reviewer, append exactly one dated C1 decision entry to `Core: docs/loop/DUAL_SPIRAL_CHECKPOINTS.md` in the paired documentation commit. Link the redacted artifact, PRs/commits, contract version, tests, E2, teacher decision, `external_send=false`, rollback, residual risk, and next entry point; never rewrite C0.1 or an earlier entry.
6. Run:

~~~sh
EDUPI_CORE_ROOT=<paired-worktree> npm run test:edupi-c1-e2
node --test scripts/verify-edupi-c1-e2.test.mjs
~~~

Expected: PASS only with the shared redacted E2 artifact. Any unavailable/failure/timeout/mismatched ID leaves C1 evidence_pending; no exception or fixture substitution is allowed.

Acceptance: This is the mandatory shared C1 E2 gate and the first Desktop task that can make C1 eligible to pass. On success it prepares the paired Core ledger edit in Core docs/loop/DUAL_SPIRAL_CHECKPOINTS.md and appends the dated C1 ledger entry/status decision; on failure it appends evidence_pending. The paired documentation commit must be append-only, link the exact E2 artifact/PRs/commits, and never rewrite C0.1 or an earlier C1 entry. Browser/component proof may be additional, but this orchestrator owns the cross-boundary ID/hash evidence.

Rollback: preserve the failed redacted artifact, mark C1 evidence_pending, and disable the product checkpoint; if the paired Core documentation edit has started, revert only the uncommitted/failed append or append a correction entry without rewriting history. Never downgrade the gate to E1 fixtures.
Suggested commit: test(desktop): prove shared C1 E2 through production bridge

## Later-slice consumer contract substeps

The table below is a summary only. The explicit executable consumer contract tasks follow it and are the authoritative task graph. Each task is XS/S/M, touches no more than five exact files, and follows: failing consumer/schema/fixture test; run and capture FAIL; additive bounded mapper/fixture and manifest reason; focused test plus fixture-manifest hash; commit. No behavior task may call a command absent from supported_commands.

| Contract ID (summary only) | Files (exact, maximum five) | Consumer addition / verifier | Acceptance / rollback / commit |
| --- | --- | --- | --- |
| C2-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/context-review.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | review_teacher_context | paired Core handler/manifest task required; otherwise read-only |
| C3-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/work-candidate-review.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | review_work_candidate suppress/snooze/hold | next-cycle fields/hash required |
| C4-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/teaching-adjustment-review.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | review_teaching_adjustment | source/hash/review receipt required |
| C5-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/follow-up-review.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | review_follow_up privacy-bounded | no diagnosis/external send |
| C6-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/education-intake.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | import commands with staging/hash/root | paired handler/root proof required |
| C7-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/insight-review.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | review_insight | evidence/next-cycle receipt required |
| C8-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/growth-review.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | review_growth_candidate/review_learning_candidate | independent eval/reload/rollback required |
| C9-consumer | lib/edupi-bridge-contract.ts; fixtures/edupi-bridge/v1/action-preview.json; fixtures/edupi-bridge/v1/fixture-manifest.json; lib/edupi-bridge-contract.test.mjs; contracts/edupi-core-compat.json | preview/approve/stop/report_action_result claim/final action | explicit permission/authorization/claim/final/stale/receipt/stop/outcome_unknown required |

## Task 6C2: Add the teacher-context consumer contract

Size: S
Depends on: Task 5E2, Core Task 9C2, and Core Task 9M2
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/context-review.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: begin only after shared C1 E2 has passed through Task 5E2. Copy and validate the Core Task 9M2 fixture manifest with the C2 slice fixture, then independently update the Desktop-owned compat manifest. Validate/map review_teacher_context without enabling it before the paired Core handler/fixture; unavailable or failed C1 remains evidence_pending and blocks this consumer work.

Steps:

1. Add a failing test for bounded context fields, receipt/history summary, schema hash, and absent supported capability.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the context consumer fixture is absent.
3. Copy the updated Core fixture-manifest.json alongside the C2 fixture, verify its hash, and independently update the Desktop-owned compat manifest with the verified Core identity; do not copy compat from Core or enable the command.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with read-only capability status.
5. Commit after Core handler/fixture review is linked.

Acceptance: schema/fixture drift fails closed; review_teacher_context remains absent until paired enablement, and no C2 consumer/fixture work begins before shared C1 E2 passes. If C1 is unavailable or failed, this task remains evidence_pending.
Rollback: revert fixture/manifest and keep onboarding read-only.
Suggested commit: test(desktop): add teacher-context consumer contract

## Task 7C3: Add proactive work feedback consumer contract

Size: S
Depends on: Task 6C2, Core Task 10C3, and Core Task 10M3
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/work-candidate-review.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 10M3 fixture manifest with the C3 slice fixture, independently update the Desktop-owned compat manifest, and validate modify with bounded title/summary/due_at patch plus suppress/snooze/hold/accept work-candidate receipts and next-cycle fields without enabling Today mutation.

Steps:

1. Add a failing test for bounded modify patch, suppression/snooze expiry, evidence, revision, receipt decision/phase, and unsupported capability.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the work-feedback fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest from verified identities, and add the additive mapper/fixture and unsupported reason.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with controls still read-only.
5. Commit after paired Core review.

Acceptance: no command absent from supported_commands is called.
Rollback: revert and leave Today suppression read-only.
Suggested commit: test(desktop): add proactive work feedback consumer

## Task 8C4: Add teaching-adjustment consumer contract

Size: S
Depends on: Task 7C3, Core Task 11C4, and Core Task 11M4
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/teaching-adjustment-review.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 11M4 fixture manifest with the C4 slice fixture, independently update the Desktop-owned compat manifest, and validate source/hash/evidence/review_teaching_adjustment output without treating candidates as facts.

Steps:

1. Add a failing source/hash/review/receipt fixture test.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the teaching-adjustment fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest, and add the additive mapper/fixture and unsupported reason.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with candidate-only projection.
5. Commit after paired Core review.

Acceptance: teaching adjustment is receipt/evidence-bound; no handler is claimed early.
Rollback: revert and leave teaching candidates read-only.
Suggested commit: test(desktop): add teaching adjustment consumer

## Task 9C5: Add follow-up consumer contract

Size: S
Depends on: Task 8C4, Core Task 12C5, and Core Task 12M5
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/follow-up-review.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 12M5 fixture manifest with the C5 slice fixture, independently update the Desktop-owned compat manifest, and validate privacy-bounded review_follow_up state, holds, evidence, and receipts.

Steps:

1. Add a failing fixture test for teacher_internal scope, high-risk hold, and external_send=false.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the follow-up fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest, and add the additive mapper/fixture and unsupported reason.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with no diagnosis/external delivery.
5. Commit after paired Core review.

Acceptance: follow-up remains read-only until paired handler proof.
Rollback: revert and keep follow-up controls disabled.
Suggested commit: test(desktop): add follow-up consumer contract

## Task 10C6: Add staged intake consumer contract

Size: S
Depends on: Task 9C5, Core Task 13C6, and Core Task 13M6
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/education-intake.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 13M6 fixture manifest with the C6 slice fixture, independently update the Desktop-owned compat manifest, and validate import_calendar/import_timetable/intake_material staging_id/path/hash/size/kind fields and receipts.

Steps:

1. Add a failing fixture test for staging root, hash/size mismatch, bounded arrays, and held dates.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the intake fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest, and add the additive mapper/fixture and unsupported reason.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with import controls visibly disabled until Core proof.
5. Commit after paired Core review.

Acceptance: staging descriptors cannot bypass root/hash validation.
Rollback: revert and keep imports read-only.
Suggested commit: test(desktop): add staged intake consumer contract

## Task 11C7: Add insight consumer contract

Size: S
Depends on: Task 10C6, Core Task 14C7, and Core Task 14M7
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/insight-review.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 14M7 fixture manifest with the C7 slice fixture, independently update the Desktop-owned compat manifest, and validate evidence-bound review_insight accept/reject/hold/not_useful/suppress feedback, bounded suppression scope/reason, receipts, and next-cycle summaries.

Steps:

1. Add a failing fixture test requiring evidence IDs, bounded feedback, distinct not_useful versus suppress decisions, valid suppression scope/reason, and receipt phase.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the insight fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest, and add the additive mapper/fixture and unsupported reason.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with insight mutation disabled.
5. Commit after paired Core review.

Acceptance: no unsupported insight command is routed.
Rollback: revert and keep insight read-only.
Suggested commit: test(desktop): add insight consumer contract

## Task 11C8: Add growth consumer contract

Size: S
Depends on: Task 11C7, Core Task 15C8, and Core Task 15M8
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/growth-review.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 15M8 fixture manifest with the C8 slice fixture, independently update the Desktop-owned compat manifest, and validate review_growth_candidate/review_learning_candidate evaluation, approval, reload, route-use, and rollback summaries.

Steps:

1. Add a failing fixture test rejecting promotion without independent evidence.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the growth fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest, and add the additive mapper/fixture and unsupported reason.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with learning candidates pending.
5. Commit after paired Core review.

Acceptance: no automatic skill promotion is represented.
Rollback: revert and keep growth candidates pending.
Suggested commit: test(desktop): add growth consumer contract

## Task 12C9: Add action consumer contract

Size: S
Depends on: Task 11C8, Core Task 16C9, and Core Task 16M9
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v1/action-preview.json
- fixtures/edupi-bridge/v1/fixture-manifest.json
- lib/edupi-bridge-contract.test.mjs
- contracts/edupi-core-compat.json

Behavior: copy and validate the Core Task 16M9 fixture manifest with the C9 slice fixture, independently update the Desktop-owned compat manifest, and validate all four action commands—request_action_preview, approve_action, stop_action, and report_action_result claim/final—with both execution-owner paths, permission/spec binding, authorization versus completion, redacted action summaries, stale/forged/expired replay, stop-race, crash/outcome_unknown, audit, and emergency-stop fields.

Steps:

1. Add a failing fixture test rejecting arbitrary action shapes, caller-selected execution_owner, caller-supplied preview_token, missing stop/permission fields, and raw execution_token everywhere except a clearly synthetic immediate desktop-native authorization `CoreReceipt.action_authorization`. Reject it from preview/claim/result/mutation/stop receipts, ReceiptSummary, ReviewHistorySummary, CoreSnapshot/action projections, logs, diagnostics, fixtures, and evidence snapshots; changed/forged/expired reports, claim/final mismatch, claim after issued -> invalidated, and incomplete outcome_unknown handling also fail. Cover Core-owned internal-draft/task mutation and Desktop-native open_local_file.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the action fixture is absent.
3. Copy the updated Core fixture manifest, independently update the Desktop-owned compat manifest, and add the additive mapper/fixture and unsupported reason. Keep the four C9 controls disabled until Task 12E9; the consumer contract must nevertheless validate preview -> authorization -> claim -> exact `open_path` -> final and redaction. An authorization-response fixture may carry only a clearly synthetic token in the immediate `action_authorization` field; all copied summary/history/snapshot fixtures are token-redacted.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with action controls disabled.
5. Commit after paired Core review.

Acceptance: action execution remains disabled until Core and Desktop policy/receipt/native-result proof; the consumer accepts only Core-derived owner/spec/permission and never treats authorization as completion.
Rollback: revert and keep action disabled.
Suggested commit: test(desktop): add action consumer contract

## Task 6E2: Enable the proven teacher-context command

Size: M
Depends on: Task 4E, Task 6C2, and Core Task 9E2
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/context-review.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the two C1 commands and add exactly review_teacher_context to supported_commands after Core handler/projection/receipt proof, consumer fixture verification, and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 9E2. The resulting ordered list is review_observation, review_memory_candidate, review_teacher_context.

Steps:

1. Add a failing test for absent capability, Core capability mismatch, loss of either C1 command, and any capability list other than the exact cumulative three-command list.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL because the paired capability is not proven.
3. Pin Core handler/schema/fixture hashes, update the command client, preserve both C1 names, and add only review_teacher_context.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with exactly review_observation, review_memory_candidate, and review_teacher_context, in that order, and no other capability enabled.
5. Commit after paired review.

Acceptance: context mutation is enabled only through the proven Core handler and receipt; both C1 commands remain present.
Rollback: remove only review_teacher_context from supported_commands and preserve the two C1 commands while keeping onboarding read-only.
Suggested commit: feat(desktop): enable proven teacher-context command

## Task 7E3: Enable the proven proactive work command

Size: M
Depends on: Task 6E2, Task 7C3, and Core Task 10E3
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/work-candidate-review.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative C1/context list and add exactly review_work_candidate with accept/modify/reject/hold/suppress/snooze, including the bounded modify patch, only after Core handler/projection/receipt proof and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 10E3. The resulting list is review_observation, review_memory_candidate, review_teacher_context, review_work_candidate.

Steps:

1. Add a failing capability/fixture mismatch test for missing prior names, duplicate names, any list other than the exact four-command cumulative list, invalid modify patch fields, and invalid decision/receipt phase pairs.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired Core proof.
3. Pin the paired identity, preserve the three prior commands, and add only the proven review_work_candidate command.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with exactly the three prior commands plus review_work_candidate; unsupported commands remain disabled.
5. Commit after paired review.

Acceptance: Today feedback cannot call an unproven handler and all prior supported commands remain enabled.
Rollback: remove only review_work_candidate from supported_commands and keep the prior cumulative list/Today read-only.
Suggested commit: feat(desktop): enable proven proactive work command

## Task 8E4: Enable the proven teaching-adjustment command

Size: M
Depends on: Task 7E3, Task 8C4, and Core Task 11E4
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/teaching-adjustment-review.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative four-command `supported_commands` list and add exactly review_teaching_adjustment only after source/hash/receipt projection proof and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 11E4. The resulting list contains the prior four commands plus review_teaching_adjustment.

Steps:

1. Add a failing capability/fixture mismatch test for missing prior commands, duplicate commands, or a list other than the exact five-command cumulative list.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired proof.
3. Pin the paired identity, preserve all prior commands, and add only review_teaching_adjustment.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with the prior four commands preserved and exactly review_teaching_adjustment added.
5. Commit after paired review.

Acceptance: teaching adjustment remains receipt/evidence-bound and prior supported commands remain present.
Rollback: remove only review_teaching_adjustment and keep the prior cumulative list/teaching read-only.
Suggested commit: feat(desktop): enable proven teaching-adjustment command

## Task 9E5: Enable the proven follow-up command

Size: M
Depends on: Task 8E4, Task 9C5, and Core Task 12E5
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/follow-up-review.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative five-command `supported_commands` list and add exactly review_follow_up only after privacy-bounded Core receipt/history proof and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 12E5. The resulting list contains the prior five commands plus review_follow_up.

Steps:

1. Add a failing capability/fixture mismatch test for missing prior commands, duplicate commands, or a list other than the exact six-command cumulative list.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired proof.
3. Pin the paired identity, preserve all prior commands, and add only review_follow_up.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with the prior five commands preserved and exactly review_follow_up added; no diagnosis/external delivery.
5. Commit after paired review.

Acceptance: follow-up is enabled only teacher-internally and prior supported commands remain present.
Rollback: remove only review_follow_up and keep the prior cumulative list/follow-up read-only.
Suggested commit: feat(desktop): enable proven follow-up command

## Task 10E6: Enable the proven staged intake commands

Size: M
Depends on: Task 9E5, Task 10C6, and Core Task 13E6
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/education-intake.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative six-command `supported_commands` list and add exactly import_calendar, import_timetable, and intake_material only after Core staging/root/hash/receipt proof and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 13E6. The resulting list contains all prior commands plus those three imports.

Steps:

1. Add a failing capability/fixture mismatch test for all prior names, all three imports, duplicate names, and any list other than the exact nine-command cumulative list.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired proof.
3. Pin the paired identity, preserve all prior commands, and add only the three proven intake commands.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with all prior commands preserved and exactly the three imports added; source staging and hash checks remain required.
5. Commit after paired review.

Acceptance: imports never bypass Desktop staging or Core receipt; all prior supported commands remain present.
Rollback: remove only import_calendar, import_timetable, and intake_material and preserve the prior cumulative list while disabling mutation controls.
Suggested commit: feat(desktop): enable proven staged intake commands

## Task 11E7: Enable the proven insight command

Size: M
Depends on: Task 10E6, Task 11C7, and Core Task 14E7
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/insight-review.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative nine-command `supported_commands` list and add exactly review_insight only after evidence/next-cycle Core proof and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 14E7. The resulting list contains the prior nine commands plus review_insight, with accept/reject/hold/not_useful/suppress decision compatibility and bounded suppression scope/reason.

Steps:

1. Add a failing capability/fixture mismatch test for missing prior names, duplicate names, any list other than the exact ten-command cumulative list, invalid suppress scope/reason, and invalid decision/receipt phase pairs.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired proof.
3. Pin the paired identity, preserve all prior commands, and add only review_insight.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with the prior nine commands preserved and exactly review_insight added; feedback remains evidence-bound.
5. Commit after paired review.

Acceptance: unsupported insight mutation remains disabled until this proof, and all prior supported commands remain present.
Rollback: remove only review_insight and keep the prior cumulative list/insight read-only.
Suggested commit: feat(desktop): enable proven insight command

## Task 11E8: Enable the proven growth commands

Size: M
Depends on: Task 11E7, Task 11C8, and Core Task 15E8
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/growth-review.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative ten-command `supported_commands` list and add exactly review_growth_candidate and review_learning_candidate only after independent evaluation/reload/rollback proof and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 15E8. The resulting list contains the prior ten commands plus those two growth commands.

Steps:

1. Add a failing capability/fixture mismatch test for missing prior names, duplicate names, and any list other than the exact twelve-command cumulative list.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired proof.
3. Pin the paired identity, preserve all prior commands, and add only the two proven growth commands.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with the prior ten commands preserved and exactly the two growth commands added; pending/rollback states remain preserved.
5. Commit after paired review.

Acceptance: no automatic skill promotion is enabled and all prior supported commands remain present.
Rollback: remove only review_growth_candidate and review_learning_candidate and preserve the prior cumulative list while keeping candidates pending.
Suggested commit: feat(desktop): enable proven growth commands

## Task 12E9: Enable the proven action commands

Size: M
Depends on: Task 11E8, Task 12C9, Task 12, and Core Task 16E9
Files (exactly five):

- contracts/edupi-core-compat.json
- fixtures/edupi-bridge/v1/action-preview.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- lib/edupi-bridge-command-client.ts

Behavior: preserve the cumulative twelve-command `supported_commands` list and add exactly request_action_preview, approve_action, stop_action, and report_action_result only after Core permission/preview/authorization/claim/final receipt proof, Desktop native invocation proof, restart/replay, token-redaction, stale/forged/expired-report, stop-race, outcome_unknown proof, and fresh component-manifest proof. Independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash` from Core Task 16E9. The resulting list contains all prior commands plus those four action commands. This is the final C9 enablement gate; Core publication alone never enables the controls.

Steps:

1. Add a failing capability/fixture mismatch test for all prior names, all four action commands, duplicate names, both owner paths, preview-only behavior, caller-supplied preview-token rejection, Core-generated preview-token binding, authorization-not-completion, issued -> invalidated stop and claim rejection, claim/final binding, exact native invocation attestation, token redaction, exact replay versus changed replay, stale/forged/expired reports, restart, emergency stop, crash/lost-report outcome_unknown, and no automatic native retry.
2. Run: node --test lib/edupi-bridge-contract.test.mjs
   Expected: FAIL before paired proof.
3. Pin the paired identity, preserve all prior commands, and add only the four C9 action commands after the full producer/consumer/native proof.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
Expected: PASS with all prior commands preserved and exactly the four action commands added; arbitrary actions remain rejected, authorization is not completion, raw tokens are absent from all projections, and lost final reports remain expired/unknown.
5. Commit after paired review.

Acceptance: action controls enable only after exact Core authorization and Desktop-native claim/final proof; all prior supported commands remain present, external_send remains false, and `completed` means only a Desktop attestation that the exact allowlisted Tauri invocation returned success.
Rollback: remove only request_action_preview, approve_action, stop_action, and report_action_result and preserve the prior cumulative list while disabling controls; never repeat a native action automatically.
Suggested commit: feat(desktop): enable proven action commands

## Task 6: Add Chat-guided teacher context and onboarding projection

Size: M
Depends on: Task 5, Task 6C2, Task 6E2, Core Task 9, and Core Task 9E2
Files (maximum five):

- components/EduPiContextEditor.tsx
- components/EduPiEducationPanel.tsx
- app/api/edupi/onboarding/route.ts
- lib/edupi-onboarding-types.ts
- components/EduPiWorkbench.test.mjs

Behavior: Chat remains the setup entrance; Desktop shows the proposed teacher role/subject/grade/class/preferences, asks for review, and refreshes after the Core receipt. It does not expose provider/API configuration to ordinary teachers. Its GET projection uses only the validated Core snapshot adapter from Task 3F; it never reads local Core preferences as a fallback.

The review_teacher_context control remains visibly disabled/read-only until Task 6C2, the paired Core handler/fixture, schema hash, and manifest update pass; it never calls saveTeacherContext directly.

Steps:

1. Add failing tests for empty context, proposed context, correction, accepted receipt, held context, and attempt to submit a credential/API field.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
~~~

Expected before implementation: FAIL if onboarding state is TUI-only, if a field can be persisted locally, or if a secret field reaches the command payload.

3. Implement the context projection/editor using the typed Core command and existing onboarding route only as a compatibility adapter. Keep secret/config fields outside the teacher contract.
4. Show evidence/source and review status, not an “AI knows you” claim. Preserve task/session context across refresh.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; corrections are receipt-backed, secrets are rejected, and accepted context appears in the next snapshot.

Acceptance: C2 works for teacher-internal context and does not become an admin/settings redesign.

Rollback: return to Chat-only context capture while keeping the Core record; do not write a local context copy.
Suggested commit: feat(desktop): add reviewable teacher context setup

## Task 7: Project proactive Today preparation with suppression controls

Size: M
Depends on: Task 5, Task 7C3, Task 7E3, Core Task 10, and Core Task 10E3
Files (maximum five):

- lib/edupi-workbench.ts
- components/EduPiWorkspaceViews.tsx
- components/EduPiTaskStage.tsx
- app/edupi-workbench.css
- components/EduPiWorkbench.test.mjs

Behavior: Today shows what needs teacher attention, what Core prepared, why it surfaced, and review/suppression actions. It does not become a dashboard of irrelevant statistics or generate placeholder deliverables.

Steps:

1. Add failing tests for source-linked candidate, missing-date hold, suppressed candidate, accepted candidate, no-deliverables state, and repeated suppression.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL where Today lacks source/review state or repeats suppressed reminders.

3. Implement a content-first task list/timeline and compact inspector; carry visual polish only where it clarifies evidence, status, and action. Keep future tasks out of “today” until Core says they are due.
4. Send suppression/hold through typed Core commands, then refresh the snapshot and display the receipt. Do not write browser storage as canonical state.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; Today is actionable, suppression is visible and durable through Core, and missing dates remain held.

Acceptance: C3 reports reminder annoyance/suppression instrumentation fields without student surveillance; Chat remains available as the primary entrance.

Rollback: disable the Today candidate view and retain existing read-only task navigation.
Suggested commit: feat(desktop): add evidence-first Today preparation view

## Task 8: Project material-driven teaching adjustment

Size: M
Depends on: Task 7, Task 8C4, Task 8E4, Core Task 11, and Core Task 11E4
Files (maximum five):

- components/EduPiMaterialModule.tsx
- components/EduPiWorkspaceViews.tsx
- components/EduPiTaskStage.tsx
- lib/edupi-workbench.ts
- components/EduPiWorkbench.test.mjs

Behavior: a teacher opens source material/evidence, sees the candidate error pattern and proposed next-lesson adjustment, reviews or corrects it, and receives a Core receipt. No opaque student score or one-click complete lesson plan is presented as truth.

Steps:

1. Add failing tests for source file/hash, candidate-only artifact, evidence checklist, teacher modification, rejection, and no-deliverable state.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL if material is shown without provenance or if inferred output is displayed as confirmed.

3. Add evidence rows, artifact state, revision, and review controls to the existing task workbench. Reuse file viewer/access rules; do not add a general filesystem browser.
4. Route all review through the Core command client and refresh the snapshot after the receipt.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; accepted/modified/rejected state, source lineage, and rollback affordance are visible.

Acceptance: C4 supports evidence reuse and teacher correction while preserving Chat/task continuation.

Rollback: hide candidate artifacts and return to source-only view; keep Core evidence and receipt history.
Suggested commit: feat(desktop): show reviewed teaching adjustment evidence

## Task 9: Project student/class/family follow-up safely

Size: M
Depends on: Task 5, Task 9C5, Task 9E5, Core Task 12, and Core Task 12E5
Files (maximum five):

- components/EduPiWorkspaceViews.tsx
- components/EduPiInspector.tsx
- components/EduPiReviewTaskCard.tsx
- lib/edupi-workbench.ts
- components/EduPiWorkbench.test.mjs

Behavior: Desktop distinguishes teacher observation, Core candidate, review state, and any permission-required external draft. It never labels a student or sends family content.

Steps:

1. Add failing tests for class/student IDs with evidence, candidate follow-up, sensitive/high-risk hold, teacher correction, external draft permission_required, and no external send.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL if a student event is rendered as a diagnosis/fact without lineage or if a family action can look sent.

3. Implement a privacy-conscious task/inspector projection. Use neutral state labels, source/evidence links, and a concise safety reason; never show raw chain of thought.
4. Route accept/modify/reject/hold through Core; display external_send and permission state even when the value is false.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; sensitive items hold, external drafts are visibly not approved/sent, and no arbitrary student scoring is present.

Acceptance: C5 is a teacher-internal follow-up surface; it does not claim student outcomes or family communication success.

Rollback: remove follow-up projection and leave Core candidate/receipt state intact.
Suggested commit: feat(desktop): add safe student follow-up review projection

## Task 10: Import semester/calendar/material input through Core commands

Size: M
Depends on: Task 2, Task 3, Task 3A, Task 7, Task 10C6, Task 10E6, Core Task 13, and Core Task 13E6
Files (maximum five):

- components/EduPiCalendarModule.tsx
- components/EduPiRhythmImporter.tsx
- components/EduPiMaterialModule.tsx
- app/api/edupi/education/route.ts
- components/EduPiWorkbench.test.mjs

Behavior: Desktop validates form bounds, submits typed import commands, and displays Core results. It does not write calendar.json, timetable.json, material_candidates.json, or any memory file directly.

Steps:

1. Add failing tests for valid event/material, missing date, invalid date, conflict/hold, duplicate import, source hash, and external_send=false.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
~~~

Expected before implementation: FAIL because current import routes write JSON locally or accept values without the Core envelope.

3. Reuse Task 3A's typed Core command client/receipt path; retain the route only as an authenticated forwarder/compatibility adapter. Show source, hash, confidence, and held status.
4. Refresh from a validated Core snapshot after each receipt. Do not display a generated deliverable when Core reports none.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; missing/conflicting dates hold, duplicates are idempotent, and no local JSON file is changed by the Desktop command path.

Acceptance: C6 provides a teacher-friendly input surface with one Core truth source and clear rollback/review.

If import_calendar, import_timetable, or intake_material is absent from supported_commands, this task verifies the visibly disabled/read-only state and does not claim the domain handler is enabled. Enablement requires the paired Core Task 13 fixtures, manifest update, schema hash, and PR review.

Rollback: disable imports and retain read-only Core projection; restore only through Core receipt/backup, never from browser state.
Suggested commit: feat(desktop): route calendar and material intake through Core

## Task 11: Show insight feedback and professional evidence

Size: M
Depends on: Task 5, Task 7, Task 8, Task 11C7, Task 11C8, Task 11E7, Task 11E8, Core Task 14, Core Task 14E7, Core Task 15, and Core Task 15E8
Files (maximum five):

- components/EduPiWorkspaceViews.tsx
- components/EduPiInspector.tsx
- components/EduPiTaskStage.tsx
- lib/edupi-workbench.ts
- components/EduPiWorkbench.test.mjs

Behavior: Desktop distinguishes evidence-backed signal, candidate insight, confirmed memory, learning candidate, and rollback. Teacher feedback is a typed Core command and the next snapshot visibly changes retrieval/suppression or review state.

Steps:

1. Add failing tests for evidence-backed insight, no-evidence insight, teacher accept/correct/reject/hold, suppression, confirmed growth evidence, and pending skill promotion.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL if the view treats all insights as facts or implies automatic skill promotion.

3. Implement content-first evidence/feedback panels with source IDs, confidence/status, teacher decision, and receipt. Use concise factors only; never expose raw chain of thought or biological consciousness language.
4. Display learning candidates as pending review with independent-evaluation/reload/route-use requirements and rollback link.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; feedback state is explicit, evidence is reusable, and no candidate is shown as active skill without Core proof.

Acceptance: C7/C8 give teachers an inspectable learning loop and durable professional asset view, not a self-congratulatory dashboard.

Rollback: hide insight/growth views and retain read-only Core state; never delete feedback or evolution receipts.
Suggested commit: feat(desktop): expose evidence feedback and professional growth state

## Task 12: Add permission-gated local action preview with emergency stop

Size: M
Depends on: Task 3, Task 12C9, Core Task 16, and Core Task 16E9
Files (maximum five):

- lib/rpc-manager.ts
- lib/edupi-computer-tool.ts
- lib/desktop-computer-use.ts
- lib/edupi-computer-use.test.mjs
- hooks/edupi-app-control.test.mjs

Scope: only the C9 `desktop_native` action `open_local_file`, after Core preview/authorization and immediately before the existing `openPathNative`/Tauri `open_path` invocation. Default remains disabled behind the manifest/capability gate while this adapter is implemented. Core derives `execution_owner`; Desktop may echo/validate but never choose it. This task does not authorize external send or arbitrary OS control.

Current executor/bypass inventory (the closure owned by Task 12):

| Reachable path | Current risk | Required C9 closure |
| --- | --- | --- |
| `lib/rpc-manager.ts` | registers `createEduPiComputerUseTool` for agent sessions | remove/disable the broad registration for the C9 product path, or prove it is visibly unavailable and unreachable |
| `lib/edupi-computer-tool.ts` | broad `ComputerUseInput`/agent tool surface can route arbitrary computer actions | reject the broad input for C9 and expose only the bounded unavailable/read-only state |
| `lib/desktop-computer-use.ts` | invokes `computer_use_execute`/`executeComputerUseNative` | make the C9 adapter call only `openPathNative`/Tauri `open_path`; never invoke the broad executor |
| `components/AppShell.tsx` | `runComputerUseFromAgent` callback can reach the agent bypass | tests must prove no C9 action can reach this callback; AppShell need not change if registration removal makes it unreachable |
| `src-tauri/src/lib.rs` plus Tauri permission/capability command identity | native command permissions could broaden execution | retain only the existing allowlisted `open_path` identity for C9 and verify the permission boundary |

Steps:

1. Add failing tests for no permission, caller-supplied preview_token, preview/spec mismatch, stale snapshot, explicit teacher approval, duplicate operation, owner mismatch, arbitrary selector/script/URL/path, shell/external-send attempt, broad `ComputerUseInput`, `computer_use_execute`, `executeComputerUseNative`, and `createEduPiComputerUseTool` C9 reachability, claim-before-native, exactly one `open_path` call, final-after-native, exact allowlisted Tauri command identity, token redaction, stale/forged/expired reports, changed replay, issued -> invalidated claim rejection, crash/lost-final outcome_unknown, emergency stop before/after claim, and no automatic retry.
2. Run:

~~~sh
node --test lib/edupi-computer-use.test.mjs hooks/edupi-app-control.test.mjs
~~~

Expected before implementation: FAIL if a new action shape lacks preview/approval/snapshot/audit/stop fields.

3. Remove/disable the broad C9 registration/execution route: prove the current `lib/rpc-manager.ts` -> `createEduPiComputerUseTool` -> `runComputerUseFromAgent`/`components/AppShell.tsx` -> `lib/desktop-computer-use.ts` -> `computer_use_execute` path is unreachable or visibly unavailable for C9. The C9 adapter must never call `invokeDesktop("computer_use_execute")` or `executeComputerUseNative`; it accepts only Core-resolved `open_local_file` and calls `openPathNative`/Tauri `open_path` after allowed-root realpath revalidation. With the manifest still disabled, the UI is read-only but the adapter tests the future path.
4. Require a Core action preview, exact action_spec_hash, Core-derived owner, permission scope, snapshot/state identity, operation ID, authorization receipt, and scoped expiring token before native execution. Immediately before the one exact `open_path` invocation, send a one-shot `report_action_result` claim; after that invocation, send one final report with native_execution_id, canonical report_hash, the exact `open_path` identity, target identity hash, status, observed_at, and bounded evidence. An exact replay with the same idempotency key/report hash returns the original Core receipt; changed, forged, stale, or expired replay fails closed. Reject arbitrary actions and do not add selectors/scripts/raw URLs.
5. Show a clear preview, approve/reject controls, authorization versus execution state, audit/receipt, stale/expired/unknown state, and emergency stop. Before claim, send stop_action through Core so Core atomically changes the issued desktop-native execution token state to `invalidated` and action state to `stopped`; a later claim is rejected and an identical stop replay returns the same receipt. After claim it records stop_requested. Revalidate allowed-root containment immediately before the Tauri invocation, never use shell, never expose/render/log raw execution_token, and disable the action while stop is active. Report stopped only after confirming no invocation occurred or a cancellable operation confirms cancellation; open_local_file is non-cancellable. A lost final report cannot be marked completed/failed/stopped by guess.
6. Run:

~~~sh
node --test lib/edupi-computer-use.test.mjs hooks/edupi-app-control.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; no C9 action reaches `computer_use_execute` or the broad agent tool, exactly one claimed `open_path` invocation precedes final attestation, emergency stop/race/crash behavior is testable, and unknown outcomes are not guessed.

Acceptance: C9 is permission-gated and auditable. Core-owned actions complete only through Core mutation receipts; Desktop-native actions are complete only after the final attestation receipt, where `completed` means the exact allowlisted Tauri invocation returned success—not that the teacher viewed the file or that the OS effect was independently verified. It is not a general computer-use feature and never sends externally by default.

If request_action_preview is absent from supported_commands, the action surface remains visibly disabled/read-only with the manifest reason; enablement requires the paired Core Task 16 policy/receipt fixtures, schema hash, and PR review.

Rollback: turn off the action capability and leave a read-only receipt/error view; preserve audit records.
Suggested commit: feat(desktop): require preview approval receipt and stop for local actions

## Task 13C10: Add the external-delivery consumer contract

Size: S
Depends on: Task 12E9 and Core Task 17C10
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v2/external-delivery.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- contracts/edupi-core-compat.json

Behavior: validate the separately versioned v2.0 external_delivery lifecycle and pair its v2.0 manifest/hash/fixture without changing v1 external_send=false.

Steps:

1. Add failing tests for v2 permission/approved/sent/failed/rolled_back states, real channel IDs, redaction, paired hash, and v1 overload rejection.
2. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: FAIL because the v2 contract/fixture is absent.
3. Add the additive v2.0 consumer shape/fixture and manifest change only after Core Task 17C10 is linked; keep controls human-gated and leave v1 untouched.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with v1 unchanged and v2 explicitly versioned.
5. Commit after paired Core/Desktop review.

Acceptance: C10 cannot call external delivery without this contract, real authorization, and receipt evidence.
Rollback: revert v2 consumer/manifest and keep Feishu controls unavailable; never mutate v1.
Suggested commit: test(desktop): add versioned external delivery consumer

## Task 13: Surface real channel E4 state without overclaiming

Size: M
Depends on: Task 1A, Task 1, Task 2, Task 3, Task 13C10, Task 13E10, and Core Task 17C10 and Core Task 17E10
Files (maximum five):

- components/ExtensionStatusBar.tsx
- components/EduPiInspector.tsx
- lib/edupi-bridge-consumer.ts
- components/EduPiWorkbench.test.mjs
- docs/EDUPI_E4_DESKTOP_RUNBOOK.md (new)

Behavior: Desktop can display current-source runtime/channel/conversation/receipt states and real message IDs only when supplied by Core. It must not call a gateway handshake or fixture a Feishu E4 claim. E4 delivery state must arrive through the separately versioned external_delivery object; v1 external_send remains false.

Steps:

1. Before accepting any E4 status, require the paired external_delivery contract review, schema hash, producer/consumer fixtures, paired PR links, and fresh Sol / Max review. v1 external_send remains false and has no delivery lifecycle.
2. Add failing tests for process_alive only, channel_connected only, conversation_verified with inbound ID, outbound receipt with real message ID, duplicate/restart, and secret redaction.
3. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-bridge-contract.test.mjs
~~~

Expected before implementation: FAIL if the status bar collapses gateway/process/channel/receipt into one “online” label.

4. Implement explicit status projection with evidence level and source/instance/trace IDs. Redact tokens and private content.
5. Add the manual E4 runbook requiring human confirmation of the app/chat and send authorization. No automatic send is introduced by the UI.
6. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-bridge-contract.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; status labels distinguish E2/E3/E4, and only a real inbound/outbound ID in a paired external_delivery contract can display conversation_verified/receipt evidence.

Acceptance: C10 can report a bounded Feishu E4 fact without claiming E5 teacher value; it remains blocked if the paired external_delivery contract review or schema-hash update is absent.

Rollback: hide channel evidence and return to local runtime status; preserve redacted trace.
Suggested commit: feat(desktop): distinguish runtime channel and receipt evidence

## Task 13E10: Enable the fixed-port external-delivery projection

Size: M
Depends on: Task 13C10, Core Task 17E10, and Core Task 17M10
Files (maximum five):

- contracts/edupi-core-compat.json
- lib/edupi-bridge-manifest.ts
- fixtures/edupi-bridge/v2/external-delivery-projection.json
- fixtures/edupi-bridge/v2/fixture-manifest.json

Behavior: after Core Tasks 17E10 and 17M10 prove the production fixed-port v2.0 projection, v2.0 fixture manifest, and fresh component manifest, copy the projection fixture and child manifest, independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash`, add the ordered `contract_identities` entry `{ contract_id: "edupi-bridge-v2", contract_version: "2.0", fixture_manifest_path: "fixtures/edupi-bridge/v2/fixture-manifest.json", supported_projections: ["external_delivery"], depends_on: ["edupi-bridge-v1@1.0"] }`, set `cumulative_projection_manifest` to the one-member v2.0 identity, and enable only `supported_projections: ["external_delivery"]`. Preserve the v1 identity, commands, and `external_send=false`.

Steps:

1. Add a failing consumer/manifest test for missing version/hash, copied-fixture or manifest drift, v1 string overload, absent real channel/message IDs, and an unapproved or gateway-only delivery state.
2. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
~~~

Expected before implementation: FAIL because the Desktop manifest has no proven v2 projection identity.

3. Copy only the paired Core v2.0 projection fixture and `fixtures/bridge/v2/fixture-manifest.json` from the pinned Core commit, update the Desktop-owned compat manifest independently with the v2.0 identity and one-member cumulative manifest, and validate the fixed-port response. Do not describe the compat manifest as a Core-copied artifact and do not enable any unsupported command.
4. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
node_modules/.bin/tsc --noEmit
~~~

Expected: PASS; the projection is enabled only for the paired version/hash/fixture and remains visibly unavailable when the fixed port lacks human-gated real evidence.
5. Commit after the paired Core Task 17E10 review.

Acceptance: Desktop Task 13E10 is the sole C10 projection enablement step. It pins the v2.0 version/schema/child-manifest identity and one-member cumulative manifest, accepts only fixed-port external_delivery evidence, publishes exactly `supported_projections: ["external_delivery"]` while preserving v1 supported_commands, leaves v1 `external_send=false`, and keeps delivery controls unavailable without real receipt IDs and authorization.
Rollback: remove `external_delivery` from the Desktop manifest, restore the prior hash/fixture pin, and show the C10 surface as read-only/unavailable; never mutate v1 or use a direct file fallback.
Suggested commit: feat(desktop): enable fixed-port external delivery projection

## Task 14C11: Add additive v2.1 teacher-outcome consumer contract

Size: S
Depends on: Task 13 and Core Task 18C11
Files (exactly five):

- lib/edupi-bridge-contract.ts
- fixtures/edupi-bridge/v2.1/teacher-outcomes.json
- lib/edupi-bridge-contract.test.mjs
- scripts/test_bridge_fixture_compat.mjs
- contracts/edupi-core-compat.json

Behavior: validate additive v2.1 aggregate teacher-outcome/evidence fields building on v2.0 external_delivery, without raw private content, student surveillance, model self-report, or any v1 mutation.

Steps:

1. Add failing v2.1 tests for time returned, decisions, held-out, restart/reload, rollback, residual risk, denominators, E-level, missing evidence, and preserved external_delivery projection.
2. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: FAIL because the v2.1 outcomes fixture/shape is absent.
3. Add the bounded v2.1 consumer/fixture and cumulative manifest identity only after Core Task 18C11 is linked; v1 remains unchanged.
4. Run: node --test lib/edupi-bridge-contract.test.mjs && node scripts/test_bridge_fixture_compat.mjs
   Expected: PASS with E5 still scoped/gated.
5. Commit after paired Core/Desktop review.

Acceptance: C11 evidence projection is bounded and auditable under v2.1, preserves v2.0 external_delivery, and enables no universal claim.
Rollback: revert only the v2.1 consumer/manifest pin and keep release evidence unverified; preserve the C10 v2.0 pin.
Suggested commit: test(desktop): add bounded teacher-outcome consumer

## Task 14: Prepare teacher E5 evidence and release-readiness projection

Size: M
Depends on: Task 13, Task 14C11, Task 14E11, and Core Task 18C11 and Core Task 18E11
Files (maximum five):

- components/EduPiInspector.tsx
- components/EduPiWorkspaceViews.tsx
- lib/edupi-workbench.ts
- components/EduPiWorkbench.test.mjs
- docs/EDUPI_E5_DESKTOP_RUNBOOK.md (new)

Behavior: Desktop displays scoped evidence, teacher decisions, baseline/candidate/held-out labels, restart/reload, rollback, trust, time returned, missed-work reduction, correction, suppression, and residual risk. It never upgrades fixture/model evidence to E5.

Steps:

1. Add failing tests for E0/E1/E2/E3/E4/E5 labels, missing denominator, missing teacher decision, held-out absent, rollback present, and unverified claim.
2. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
~~~

Expected before implementation: FAIL if the inspector displays “validated” from fixture-only or model self-report evidence.

3. Implement an evidence ledger view with source IDs, contract version/schema hash, PR/commit links, exact commands, teacher decision, external_send, rollback, and residual risk. Keep content-first hierarchy and avoid surveillance charts.
4. Provide a release checklist that links Core and Desktop PRs and states unverified items. Do not edit historical claims in place.
5. Run:

~~~sh
node --test components/EduPiWorkbench.test.mjs lib/edupi-workbench.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
~~~

Expected: PASS; only the appropriate evidence level is shown, and missing evidence is explicit.

Acceptance: C11 reports only the teacher scenario actually evaluated. E5 is never claimed from fixtures or model self-report.

Rollback: hide the evidence panel and retain raw receipts/ledger; release remains blocked until the evidence gate is met.
Suggested commit: docs(desktop): add bounded teacher evidence and release checklist

## Task 14E11: Enable bounded teacher-outcome projection

Size: M
Depends on: Task 14C11, Core Task 18E11, and Core Task 18M11
Files (maximum five):

- contracts/edupi-core-compat.json
- lib/edupi-bridge-manifest.ts
- fixtures/edupi-bridge/v2.1/teacher-outcomes-projection.json
- fixtures/edupi-bridge/v2.1/fixture-manifest.json
- fixtures/edupi-bridge/projections/fixture-manifest.json

Behavior: after Core Tasks 18E11 and 18M11 prove the bounded v2.1 outcomes projection, v2.1 child manifest, cumulative manifest, and fresh component manifest through the fixed port, copy/pin the v2.1 outcome fixture and child manifest plus the cumulative manifest, independently re-pin top-level `core_runtime.core_commit` + `component_manifest_hash`, add the ordered `contract_identities` entry `{ contract_id: "edupi-outcomes-v2.1", contract_version: "2.1", fixture_manifest_path: "fixtures/edupi-bridge/v2.1/fixture-manifest.json", supported_projections: ["external_delivery", "teacher_outcome_evidence"], depends_on: ["edupi-bridge-v2@2.0"] }`, and enable the cumulative list without dropping C10. Reuse the already pinned immutable v2.0 child manifest. The consumer displays aggregate evidence and its E-level; it never manufactures teacher outcomes or claims E5 from fixtures/model self-report.

Steps:

1. Add a failing consumer/manifest test for missing cumulative C10 identity, missing denominators, missing teacher decision, absent held-out/restart/reload/rollback evidence, raw private content, and fixture-only E5 claims.
2. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
~~~

Expected before implementation: FAIL because the pinned manifest has no proven teacher-outcome projection.

3. Copy only the paired Core v2.1 teacher-outcome projection fixture, `fixtures/bridge/v2.1/fixture-manifest.json`, and cumulative `fixtures/bridge/projections/fixture-manifest.json`; reuse the pinned immutable v2.0 child manifest; update the Desktop-owned compatibility manifest independently with both member hashes and `supported_projections: ["external_delivery", "teacher_outcome_evidence"]`; route reads through the fixed process client. Preserve visible unavailable state for incomplete evidence and never drop C10.
4. Run:

~~~sh
node --test lib/edupi-bridge-contract.test.mjs
node scripts/test_bridge_fixture_compat.mjs
node_modules/.bin/tsc --noEmit
~~~

Expected: PASS; aggregate outcomes are projected with source/hash/E-level/rollback fields, and no stronger claim is shown than the evidence supports.
5. Commit after the paired Core Task 18E11 review.

Acceptance: Desktop Task 14E11 is the sole C11 projection enablement step. It pins and preserves the cumulative list `external_delivery` plus `teacher_outcome_evidence`; Task 14 may depend on it, but E5 remains gated by a real teacher/evaluator evidence cycle and cannot be inferred from the fixture.
Rollback: remove the projection capability and fixture pin, leave the evidence view read-only, and preserve raw receipts/ledger history.
Suggested commit: feat(desktop): enable bounded teacher outcome projection

## Task 15: Run local browser, security, and release checks

Size: S
Depends on: Task 2A, Task 14, and Task 5E2
Files (read-only):

- .openclaw/AGENTS.md or repository-local instructions
- app/globals.css
- components/EduPiWorkbench.test.mjs
- lib/edupi-bridge-contract.test.mjs

Steps:

1. Run the narrow Node tests and type/lint checks for the slice.
2. Start the development server:

~~~sh
npm run dev
~~~

Expected: the server listens on 127.0.0.1:30141 without a build step. Keep the process bounded and stop it after smoke checks.

3. From a separate shell, run:

~~~sh
curl -fsS http://127.0.0.1:30141/api/edupi/education
node --test app/api/agent/events-route.test.mjs components/EduPiWorkbench.test.mjs lib/edupi-bridge-contract.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
npm run test:release-tools
git diff --check
~~~

Expected: API response is a validated projection or an explicit unavailable/unknown-version error; tests, typecheck, lint, release tools, and diff check exit 0.

4. Use the browser testing skill/available local browser only for visible verification: Chat remains usable, Today/Memory review shows provenance and candidate status, command pending/receipt states are visible, no console errors occur, and rejected candidates do not render as confirmed facts. Record browser evidence as E0/E1/E2 according to the data source.
5. Inspect git status and confirm only the task's files changed. Never use next build during dev.

Acceptance: a release/checkpoint report contains exact commands, output summaries, browser observations, evidence level, rollback, and unverified items.

Rollback: stop the dev process and revert only the task PR; do not clear unrelated .next or worktree state destructively.
Suggested commit: test(desktop): verify dual-spiral slice browser and release gates

## Task 16A: Bundle an allowlisted reviewed Core runtime

Size: M
Depends on: Task 1A, Task 2A, and Core Task 4D
Files (maximum five):

- scripts/prepare-desktop.mjs
- src-tauri/tauri.conf.json
- scripts/write-component-versions.mjs
- scripts/verify-release-components.mjs
- scripts/packaged-core-allowlist.test.mjs (new)

Behavior: after a reviewed source commit, package a reviewed Core runtime component containing only the fixed bridge entrypoint, required reviewed scripts, the exact Core-owned `contracts/edupi-desktop-component-manifest.json` identity, schema, fixtures/manifest identity, and runtime dependencies. Exclude .edupi, .env, credentials, private evidence/material, arbitrary source, and user data; do not invent a second component-manifest format. The separate signed release wrapper is created/verified by Tasks 16B–16C and is not an input to `component_manifest_hash`.

Steps:

1. Add failing tests for allowlisted paths, excluded .edupi/.env/auth/evidence/private material, deterministic component hash, and missing entrypoint.
2. Run: node --test scripts/packaged-core-allowlist.test.mjs
   Expected: FAIL because the reviewed Core bundle allowlist is not defined.
3. Implement the bundle preparation/manifest inputs and deterministic hash; carry the reviewed Core component-manifest identity unchanged and do not package secrets or user state.
4. Run: node --test scripts/packaged-core-allowlist.test.mjs && npm run release:verify
   Expected: PASS with a reviewed component manifest and fixed desktop_bridge_port.mjs resource.
5. Commit the bundle/allowlist changes after release review.

Acceptance: packaged Core is a reviewed/hashed component, not an arbitrary workspace copy; this is a foundation substep and cannot be skipped for release.
Rollback: ship the prior component version or disable Core integration; never fall back to an unreviewed source tree.
Suggested commit: build(desktop): bundle allowlisted reviewed Core runtime

## Task 16B: Pass packaged Core root, manifest, and state root to the server

Size: M
Depends on: Task 16A and Task 3B
Files (maximum five):

- src-tauri/src/lib.rs
- desktop/server-launcher.cjs
- lib/edupi-core-root.ts
- lib/edupi-core-process-client.ts
- lib/desktop-core-launch.test.mjs (new)

Behavior: surgical extension of the existing `desktop/server-launcher.cjs` behavior, not a replacement or rewrite. Preserve and regression-test its existing main/dev root compatibility mapping and orphan-prevention parent-process watchdog while passing a validated packaged Core root, the signed/hashed component wrapper containing all exact Task 16C fields—`source_commit`, `component_manifest_hash`, `bundle_hash`, `component_version`, `signing_identity`, and rollback metadata—plus the exact reviewed Core `contracts/edupi-desktop-component-manifest.json` path/identity, and PI_DESKTOP_STATE_DIR to Next. Packaged mode verifies the wrapper signature and bundle hash before launch; development mode verifies Git HEAD plus the component manifest. Neither mode invents a second manifest format, and the wrapper/signature/bundle hash are not inputs to `component_manifest_hash`.

Steps:

1. Add failing launch tests for existing main/dev root compatibility mapping, orphan-prevention parent-process watchdog behavior, packaged root/manifest, PI_DESKTOP_STATE_DIR, missing/invalid hash, origin-independent state path, and absence of Git in packaged mode.
2. Run: node --test lib/desktop-core-launch.test.mjs
   Expected: FAIL because packaged launch environment is not wired.
3. Surgically extend the existing launcher and root resolver: preserve main/dev root compatibility mapping and the orphan-prevention parent-process watchdog, then verify the carried Core component-manifest identity and all signed-wrapper fields (`source_commit`, `component_manifest_hash`, `bundle_hash`, `component_version`, `signing_identity`, rollback metadata) before launch, including wrapper signature and bundle-hash validation, and preserve desktop token/request security and process-client limits.
4. Run: node --test lib/desktop-core-launch.test.mjs && node_modules/.bin/tsc --noEmit
Expected: PASS; existing main/dev root mapping and watchdog regressions remain green, and packaged server receives only validated non-secret paths/mode/locale/manifest values.
5. Commit after Tauri/server launch review.

Acceptance: existing launcher root mapping and orphan-prevention watchdog behavior are preserved and regression-tested; packaged bridge and server state roots are explicit and validated; no arbitrary Core root or shell is accepted. This is a foundation substep and cannot be skipped for release.
Rollback: use the previous packaged component/launcher and disable Core integration if validation fails.
Suggested commit: feat(desktop): pass validated packaged Core and state roots

## Task 16C: Verify release component, bundle, signing, and rollback gates

Size: M
Depends on: Task 16A and Task 16B
Files (maximum five):

- .github/workflows/release.yml
- scripts/verify-release-components.mjs
- scripts/write-component-versions.mjs
- scripts/test-release-components.mjs (new)
- src-tauri/tauri.conf.json

Behavior: release verification creates and checks a separate signed release wrapper binding source_commit, component_manifest_hash, bundle_hash, component_version, signing_identity, and rollback metadata, plus the carried Core `edupi-desktop-component-manifest.json` identity, component hash/allowlist, and Tauri bundle resource inclusion. The wrapper/signature is not an input to `component_manifest_hash`; it fails closed when the reviewed Core runtime, exact manifest identity, bundle hash, or signature is absent.

Steps:

1. Add failing release tests for missing resource, hash drift, allowlist violation, unsigned bundle, version mismatch, and missing rollback component.
2. Run: node --test scripts/test-release-components.mjs
   Expected: FAIL because the release gate does not cover the packaged Core component.
3. Add the workflow/config/test gate and documented prior-component rollback metadata, including the exact reviewed Core component-manifest identity and separate signed wrapper fields source_commit, component_manifest_hash, bundle_hash, component_version, signing_identity, and rollback metadata. Development remains pinned-Git; packaged release does not require Git.
4. Run: node --test scripts/test-release-components.mjs && npm run release:verify
   Expected: PASS only when component hash, bundle resource, code-signing, version, and rollback checks agree.
5. Commit after release/security review.

Acceptance: release cannot claim readiness with an unverified Core component; this foundation substep remains tracked in the ledger and cannot be skipped for release.
Rollback: select the last signed component version and revert the release PR; never ship an unsigned or hash-drifting bundle.
Suggested commit: ci(desktop): gate packaged Core hash signing and rollback

## Phase exits and stop/rethink conditions

### Phase 0: reconciliation

Exit when the clean baseline, historical-document map, Core authority, original-workspace warning, first teacher observation input, external_send=false, and paired PR rule are recorded. Stop/rethink if a Desktop page is proposed as a new truth source or if an executor is told to discard WIP.

### Phase 1: C1 foundation substeps (not a product checkpoint)

Exit when:

- node --test lib/edupi-bridge-contract.test.mjs passes;
- contracts/edupi-core-compat.json pins top-level `core_runtime.core_commit`, `component_manifest_path`, and `component_manifest_hash`, plus contract schema/fixture hashes;
- unknown contract_version/schema_hash and stale snapshot fail closed;
- buildEducationContract is a pure projection and readEducationContract has no local write fallback;
- typed commands return Core receipts and no command route writes Core JSON;
- initial supported_commands and supported_projections are empty; only the paired post-Core-Tasks-5–7 update may enable the two C1 review commands, and C10/C11 projections require Tasks 13E10/14E11;
- calendar import, timetable import, task review, teacher observation/memory review, and education material intake are Core-command-backed or visibly read-only;
- task-session binding is Desktop-owned server state outside Core .edupi truth;
- onboarding GET and POST, generic file, material staging/upload, and legacy task-review paths have no direct Core read or writer; both onboarding operations use validated Core envelopes or a visible fail-closed/read-only reason.
- Task 2A has migrated or visibly retired app/api/edupi/status/route.ts and components/EduPiWorkspace.tsx; no AppShell/admin caller directly reads Core JSON.

This is a foundation gate only. Keep its ledger status in_progress or evidence_pending until the complete C1 loop passes. It cannot be reported as a passed product checkpoint. Stop/rethink if projection and mutation remain interleaved, buildEducationContract synthesizes production tasks, the consumer guesses unknown fields, any direct Desktop JSON writer remains, or the paired Core PR/fixtures are missing.

### Phase 2: C1 first passed product checkpoint

Exit when the seven-step loop is visible and receipt-backed, Core Task 8 has proven Core-only persistence, the mandatory shared Task 5E2 E2 verifier passes, refresh/replay works, rejected material never becomes a confirmed fact, and paired Core/Desktop evidence is recorded. Task 5E2 solely appends the C1 ledger entry/status decision. This is the first product checkpoint that may be marked passed. If Task 5E2 is unavailable or fails, C1 remains evidence_pending. Stop/rethink if UI success appears before receipt, if v1 external_send is not false, if external_delivery is attempted without its paired contract review, or if Chat is displaced by a card/dashboard.

### Phases 3–5: C2–C9

Each slice exits only after a real teacher input/observation can be traced to a Core snapshot, Desktop projection/control, teacher decision, Core receipt, and next-cycle projection. Stop/rethink on direct JSON writes, opaque scoring, automatic diagnosis, automatic skill promotion, arbitrary action, hidden external send, or missing stale-snapshot/stop/rollback gate.

### Phase 6: C10/C11

Exit only with Core Tasks 17E10/17M10 v2.0 fixed-port external_delivery evidence, Desktop Task 13E10 version/hash/manifest enablement, real channel IDs for E4, Core Tasks 18E11/18M11 v2.1 cumulative bounded outcome evidence, Desktop Task 14E11 cumulative consumer enablement, scoped teacher/held-out/restart/reload/rollback evidence for E5, and Tasks 16A–16C packaged Core hash/allowlist/bundle/code-signing/rollback evidence. C1 local E2 may run against a pinned worktree, but release cannot skip the reviewed packaged Core component. Fixtures, screenshots, gateway status, and model self-report remain lower evidence. Stop/rethink if the UI reports a claim stronger than its evidence or a projection bypasses the fixed bridge.

## Product outcome instrumentation

Desktop may display but never author the canonical outcome metrics. Display only aggregate, purpose-limited fields from Core:

| Metric | Projection | Guardrail |
| --- | --- | --- |
| Time returned | teacher-reported minutes saved or duration bucket per task | No token/response-length proxy |
| Missed-work reduction | teacher-confirmed due items surfaced before due | Suppression and “not useful” remain visible |
| Accepted without edit | accepted / reviewed candidates | Show denominator and evidence level |
| Correction rate | modified + rejected / reviewed | Treat correction as useful feedback |
| Reminder annoyance/suppression | snooze, suppression, not-useful, resurfacing | Suppression changes next cycle |
| Evidence reuse | later task citations of accepted evidence | Source and hash remain clickable |
| Teacher trust | voluntary rating and willingness to review/undo | No inferred emotion or student surveillance |
| Rollback frequency | rollback receipts by slice/reason | High rate blocks release review |

No chart may rank students, teachers, schools, or classrooms. No view stores raw chain of thought or credentials.

## Historical document reconciliation and supersession map

| Document | Status in this plan | Reconcile into |
| --- | --- | --- |
| docs/EDUPI_DESKTOP_IMPLEMENTATION_PLAN.md | historical implementation proposal | Tasks 1–10 with bridge split before pages |
| docs/EDUPI_PRODUCT_MODEL_INTEGRATION.md | product object/loop mapping | Core projection, task-session binding, receipt/rollback surfaces |
| docs/EDUPI_DESKTOP_ACCEPTANCE_MATRIX.md | evidence vocabulary | shared E0–E5 ledger and paired fixture gates |
| docs/EDUPI_WORKSPACE_PRESENTATION_DECISION.md | frozen visual/information architecture | content-first workspace/task surfaces; visual polish travels with slices |
| docs/THIRD_PARTY_UI_REFERENCES.md | research and license boundary | interaction inspiration only; no copied code/brand and no authority over Core truth |

Core historical inputs are reconciled in the canonical roadmap: docs/EDUPI_OPTIMIZATION_PLAN.md, docs/PRODUCT_GAP_ANALYSIS.md, docs/EDUPI_DESKTOP_INTEGRATION_BOUNDARY.md, docs/EDUPI_EDUCATION_MODULE_SKELETON.md, docs/EDUPI_RELIABLE_SELF_EVOLUTION_OPTIMIZATION_PLAN.md, and docs/loop/STATE.md. The original Core workspace has valuable uncommitted WIP and requires a dedicated reconciliation checkpoint; it is not a clean merged baseline.

## Desktop checkpoint ledger template

Use the same ID as Core:

~~~markdown
### Cx.y — <short name>

- checkpoint ID: Cx.y
- repos / PRs / commits: Core <link>; Desktop <link>; commits <sha>
- goal: <one sentence>
- input/evidence IDs: <observation/material/session/fixture/channel IDs>
- contract version / schema hash: <value>
- tests and commands: <exact commands and result>
- E-level: E0/E1/E2/E3/E4/E5, with why
- teacher decision: not_run/accepted/modified/rejected/held
- external_send: false (v1); external_delivery: omitted in v1 or separately versioned after paired review
- rollback: <cache disable, receipt rollback, feature flag, or revert PR>
- residual risk: <explicit risk or none>
- next entry point: <task/checkpoint>
~~~

## Verification matrix

Before claiming a task graph is executable, run this deterministic cross-repository dependency validator. It parses every `## Task <id>` heading, resolves every same-repository `Task <id>` reference, resolves `Core Task <id>` and `Desktop Task <id>` against the paired plan, and rejects self-dependencies or unknown IDs:

~~~sh
EDUPI_CORE_PLAN=/path/to/edupi-core/docs/plans/2026-08-24-edupi-core-optimization.md \
EDUPI_DESKTOP_PLAN=/path/to/edupi-desktop/docs/plans/2026-08-24-edupi-desktop-optimization.md \
node --input-type=module - <<'NODE'
import fs from "node:fs";

const plans = {
  edupi_core: process.env.EDUPI_CORE_PLAN,
  edupi_desktop: process.env.EDUPI_DESKTOP_PLAN,
};
const taskId = "[0-9]+(?:[A-Z][0-9A-Z]*)?";
const tasks = {};
for (const [repo, path] of Object.entries(plans)) {
  const source = fs.readFileSync(path, "utf8");
  tasks[repo] = new Set([...source.matchAll(new RegExp(`^## Task (${taskId}):`, "gm"))].map((m) => m[1]));
}
const errors = [];
let edges = 0;
for (const [repo, path] of Object.entries(plans)) {
  const source = fs.readFileSync(path, "utf8");
  const headings = [...source.matchAll(new RegExp(`^## Task (${taskId}):`, "gm"))];
  for (const [index, match] of headings.entries()) {
    const from = match[1];
    const start = match.index ?? 0;
    const end = headings[index + 1]?.index ?? source.length;
    const body = source.slice(start, end);
    const dependencyLine = body.match(/^Depends on:\s*(.*)$/m)?.[1] ?? "";
    for (const ref of dependencyLine.matchAll(new RegExp(`\\b(?:(Core|Desktop)\\s+)?Task\\s+(${taskId})`, "g"))) {
      const targetRepo = ref[1] === "Core" ? "edupi_core" : ref[1] === "Desktop" ? "edupi_desktop" : repo;
      const target = ref[2];
      edges++;
      if (!tasks[targetRepo]?.has(target)) errors.push(`${repo} Task ${from} -> unknown ${targetRepo} Task ${target}`);
      if (targetRepo === repo && target === from) errors.push(`${repo} Task ${from} -> self`);
    }
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`dependency_validation=PASS core_tasks=${tasks.edupi_core.size} desktop_tasks=${tasks.edupi_desktop.size} edges=${edges}`);
NODE
~~~

Run the narrowest check after each task, then the affected suite:

~~~sh
# baseline and scope
git rev-parse HEAD
git status --short
git diff --check

# bridge and workbench
node --test lib/edupi-core-process-client.test.mjs lib/edupi-core-root.test.mjs
node --test lib/edupi-bridge-contract.test.mjs
node --test lib/edupi-bridge-command-client.test.mjs
node scripts/test_bridge_fixture_compat.mjs
node --test lib/edupi-desktop-state-server.test.mjs lib/edupi-material-staging.test.mjs
node --test lib/edupi-workbench.test.mjs components/EduPiWorkbench.test.mjs

# mandatory shared C1 E2
EDUPI_CORE_ROOT=<paired-worktree> npm run test:edupi-c1-e2

# repository checks
node_modules/.bin/tsc --noEmit
npm run lint
npm run test:release-tools
npm test

# local API/browser smoke; do not run next build during dev
npm run dev
curl -fsS http://127.0.0.1:30141/api/edupi/education
~~~

Expected evidence is PASS, FAIL, unavailable, or not_run with actual output. A fixture pass is E1. A local Core data/restart check may be E2. E3/E4/E5 require their own runtime/channel/teacher evidence. Never claim completion when a required verifier failed or was skipped.

## Rollback and security

- Disable a projection or capability behind a feature flag or revert the focused PR; do not remove Core receipts or teacher history.
- If a command path is unsafe, make it read-only and surface the reason; do not add a local write fallback.
- Use existing request-security, project-root, file-access, desktop-token, and Tauri permission boundaries. Do not expose secrets in API responses, logs, fixtures, screenshots, or plan reports.
- A stale snapshot, unknown version, invalid provenance, missing permission, or missing receipt is a blocked operation, not a prompt to retry with guessed data.
- No external send is enabled by a UI toggle; Core must provide explicit permission and real receipt.

## Handoff after context loss

The next worker reads this README, the Core canonical roadmap, and the first unpassed Desktop task. It verifies the clean baseline and pinned manifest, runs the failing test, then implements one XS/S/M task. The fresh Sol / Max review inspects actual files, paired PRs, schema hash, status, and evidence. A bridge task is incomplete until Core producer and Desktop consumer fixtures, PR links, version/change note, and checkpoint ledger agree.

Suggested commit examples:

- feat(desktop): validate pinned Core snapshot
- refactor(desktop): separate projection from command writes
- feat(desktop): review Core observation and memory candidates
- test(bridge): reject unknown version and stale snapshot
- feat(desktop): add evidence-first Today task surface
- feat(desktop): require action preview approval receipt and stop
- docs(desktop): record E4/E5 evidence limits and rollback

Optional cadence is only a range: a small implementation slice may take hours to a few working days; a real teacher E5 cycle may take weeks. These are not delivery promises.
