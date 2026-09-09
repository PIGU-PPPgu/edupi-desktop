# ADR-004: G1 result-only live model boundary

Confirmed calendar events are also bounded G1 sources for calendar preparation.
Core resolves the exact candidate source event and evidence identity through the
canonical education projection, including intake overrides and deletion state.
Only a unique, explicitly dated, confirmed or teacher-confirmed event is eligible.
Its canonical structured JSON is sent as a `confirmed_calendar_event` source using
the existing live-v1 material fields; it is not a file or a fabricated excerpt.
The event contents and confirmation state bind the source revision and are checked
before execution, after execution and by the existing artifact commit guard.
Rescheduling, edits, withdrawal of confirmation and deletion invalidate the result.
Unknown or inferred sources stay unavailable. Classroom preparation continues to
require its original same-scope files and teacher-confirmed excerpts. All outputs
remain teacher-internal drafts with external delivery disabled.

Explicit prepare requests execute against the actual claim time even before the
task due date. The planned occurrence remains part of the stable event identity,
not an execution gate for a manual request. Existing queued `prepare:` events
retain that identity and use the execution store's scoped `requestedTaskId` path.
Automatic preparation only submits due candidates and shares the stable event
identity with an explicit request for that same task and source revision.
Calendar imports and deletions invalidate completed drafts before publishing the
changed source, with rollback on source-write failure. Calendar source-version
evidence distinguishes a later reconfirmation from its earlier stale execution.

Status: implemented adapter boundary; scheduling and production activation pending.

Material binding follow-up: `core_runtime_g1_sources.mjs` reads explicitly
selected accepted intake records in the exact subject/class scope and verifies
their bounded original files through read-only no-follow descriptors. Record
hashes bind request material revisions. Its `run` method checks source state
before and after model execution, including material deletion and byte drift.
`assertCurrent` must also be called inside the eventual admitted commit boundary;
the post-generation check alone is not an atomic publication guarantee.
`core_runtime_g1_excerpts.mjs` adds durable teacher-confirmed excerpts, bound
to the original and record hashes. Confirmation/withdrawal requires writer
admission and the expected excerpt revision. Its trusted API must receive an
authenticated reviewer identity from the future Core review entrypoint.
`createConfirmedG1Request` takes current confirmed bytes, and checks both the
original binding and excerpt revision before/after generation. Supplied request
copies cannot alter its internal model input. Unconfirmed OCR/text must first
be reviewed; automated extraction and its review entrypoint remain pending.
This records a teacher assertion of fidelity, not an independent proof that
the excerpt represents the original. No production timer has been enabled.

The current deterministic Harness remains unchanged. A separate `g1-live-v1`
request reuses its validated lease fields and adds bounded material excerpts.
Each excerpt has a unique source_id, revision, UTF-8 content and SHA-256 of
those exact bytes. The total request is limited to 64 KiB. Empty material,
duplicate identities, mismatched bytes and inconsistent work-case/revision
bindings are rejected before model invocation.

The low-level adapter validates supplied bytes only. Production integration
must use `createConfirmedG1Request` and the isolated adapter factory rather
than bypassing the source/excerpt boundary. C3/C4 still own production activation.

The legacy/test adapter can use the Pi calendar runner with an in-memory session.
`createIsolatedG1ModelAdapter` uses one fixed SDK worker process per invocation,
with no agent tools, sessions or discovered resources and no SDK retries. Model input contains
only task metadata and selected excerpts; lease secrets are not in the prompt.
The caller chooses the configured model through trusted construction options.
Tests may inject a runner, but this creates no daemon activation capability.

Output must be JSON with exactly the requested deliverable titles, nonempty
bounded text and known source_ids on each artifact. Citation existence is a
structural check, not evidence of semantic or educational correctness.
The adapter supplies the lease binding itself; a model cannot mint authority.
Only Core's eventual commit path may persist this result.

The isolated runner strips inherited application secrets and NODE_OPTIONS;
configuration uses stdin, not command arguments. Node permissions allow read
access only to the SDK installation and fixed entrypoint/package metadata, and
deny filesystem writes, child processes and threads. These are Node permission
controls, not a claim of container/OS isolation from malicious native code.

The deadline is capped at five minutes. Isolated cancellation/timeout sends
SIGKILL and waits for the child close event; the adapter waits for runner idle
before returning, so success/failure cannot hide a surviving model worker.
Provider network activity already sent before cancellation cannot be undone.
The in-process injected-runner fallback is not afforded this guarantee.

Limits: one active call per runner, configurable output cap up to 8192 tokens,
and an explicit call budget per runner instance (default three). Every attempt
consumes one reservation, including startup/provider failure. Diagnostics retain
elapsed time, result code, reaping confirmation and SDK-reported usage, never raw
errors, prompt, key or provider URL. Monetary cost is not inferred. Cross-restart
budget accounting and durable execution telemetry still belong to daemon work.

`external_send=false` means no educational message is sent to a recipient.
Calling a real provider still transmits selected input to that provider.
The current SDK integration test uses synthetic material and localhost only.

Verification: `node scripts/test_core_runtime_model_adapter.mjs` exercises
byte drift, duplicate/empty sources, malformed results, unknown citations,
wrong deliverables, provider errors, cancellation and a hung runner. It also
calls the real Pi SDK against a localhost streaming provider and checks that
no tools or persistent sessions are created.

`npm run test:core-runtime-live-model` adds admitted excerpt review/CAS,
withdrawal, changed-during-generation and reload checks; real SDK subprocess
calls to localhost prove token limits, call budgets, concurrency rejection,
inherited NODE_OPTIONS isolation, cancellation and timeout reaping. The full
fixture path runs confirmed excerpt -> isolated SDK -> validated bound result.
