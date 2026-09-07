# ADR-003: Education Fact and Capability Spines

## Status

Accepted for the deterministic G2/G3 baseline (2026-09-07). Real-teacher
product evidence remains pending.

## Authority and parity

EduPi Core owns this decision and all canonical education data. Desktop is a
validated projection and review consumer. Carrier integrations such as Desktop
Chat, Feishu, WeCom, and DingTalk are input/output adapters; none is a source of
truth.

This ADR is mirrored byte-for-byte in the Core and Desktop repositories. A
different mirror is contract drift.

## Context

The pre-existing system could retain useful teacher observations, but several
JSON stores interpreted the same sentence independently. Legacy memory merging
also allowed two different observation types about the same student to replace
one another. Markdown skills described useful workflows, but prose routing did
not prove that an output used the right term, class, source revision, or
evidence.

G2 requires one teacher utterance to become correctly scoped facts without
guessing student identity. G3 requires a due administrative package to produce
an internal draft and evidence-gap list before the deadline, survive restart,
and absorb teacher feedback without silently changing policy.

## Decision

### Education Fact v1

Core stores the verbatim observation before interpreting model output. Stable
entity IDs derive from entity kind plus a carrier-neutral namespace and external
ID. Aliases from Desktop or any carrier map to that identity and alias
collisions fail closed.

Observation, fact, hypothesis, and insight are separate record kinds. A fact
binds its entity, predicate, normalized value, source IDs, observation IDs,
confidence, revision, review history, conflicts, and supersession links.
Multiple sources enrich one fact identity. Conflicting candidates do not
replace an accepted fact. Modification creates a replacement fact and
supersedes the prior identity. Delete and restore remain soft, revisioned
operations. Conflict discovery runs again at acceptance, so candidates proposed
before either review cannot both become accepted and a fact cannot supersede
itself.

Source revision invalidates unsupported candidate, pending, or held facts.
Accepted facts are not silently rewritten. Legacy class memory remains a
read-only shadow during this phase; no destructive migration is authorized.

### G2 compiler boundary

Roster matching is exact and deterministic. Unknown or ambiguous mentions
produce held hypotheses, never guessed student facts. Model output is untrusted
and must pass a strict bounded schema; every mention and evidence quote must
exist in the preserved utterance. A model-declared unresolved mention must also
appear in that utterance, must not already resolve to one roster identity, and
must have an occurrence not owned by a longer known alias unless the exact alias
itself is genuinely ambiguous.

Model confidence does not grant acceptance. Only deterministic explicit
learning signals may enter the accepted path, and their stored fact value is
the exact supporting quote. Behavior and general observations remain pending;
safety observations remain held for a teacher decision. Invalid output or model
unavailability preserves the raw observation and writes no formal fact.

Student, teaching, and next-lesson views project the same accepted fact IDs.
Rejected, deleted, stale, or superseded facts do not enter next-lesson recall.
Fact-use records show which accepted identities each consumer used.

### Executable Capability v1

A capability is a versioned definition plus a strict run request, bounded
adapter result, deterministic checker, and run record. Inputs reference exact
case revisions, facts, materials, term, class, dates, source IDs, and hashes.
Deliverable key, title, type, content, and evidence IDs must match the capability
contract.

The generic runtime, not only an individual package wrapper, enforces that every
fact and material belongs to the requested term and class. Calendar dates must
also be real canonical dates; shape-valid values such as `2026-99-99` fail
before an adapter runs.

Capabilities have `fact_write=false` and `external_send=false`. They cannot
modify canonical facts or send to a carrier. Missing evidence, invalid input,
permission denial, model unavailability, model error, timeout, checker failure,
and stale source remain distinct outcomes.

The first package is `safety_education_term_summary`. It reads only allow-listed
predicates and material kinds for the target term and class, and every input
item requires source provenance. Its checker accepts only the summary lines and
gap list derived from those exact inputs; an unrelated same-scope fact,
source-less item, or extra uncited paragraph fails or is excluded.

### G3 scheduling and feedback

Core creates one stable capability work case from the source case and capability
ID. A trusted deadline and preparation window queue due work without asking the
teacher to start generation. The scheduler records planned/queued/running/
failed/draft-ready/stale/review transitions and source-bound artifact hashes.

Source-fingerprint changes stale prior artifacts before rerun. Retryable model
failure records a persisted bounded `next_attempt_at` backoff before it may run
again, so a fast daemon tick cannot exhaust the attempt budget. Rejected, held,
stale, running, completed, or non-retryable work cannot be bypassed by an
explicit run request. A persisted
claim binds attempt, source fingerprint, revision, acquisition time, and expiry.
Hung adapters are aborted at the bounded deadline; an expired running claim is
recovered after restart. Claim and completion use compare-and-swap checks, and
teacher modifications publish content-unique artifacts while holding the same
state lock. Persisted state rejects unknown fields, duplicate identities, path
escape, malformed references, and any external-send value other than false.
Restart reads verify every artifact as a contained regular file whose bytes
match the stored hash. Review receipts are cross-checked against their decision,
before/after states, artifact diffs, policy candidate, and teacher transition.

Teacher accept, modify, reject, and hold decisions travel through the existing
Desktop `review_task` bridge and create capability-owned receipts. A modify note
changes the source-bound summary artifact and creates a shadow policy candidate
with `applied=false`; it never changes formal policy automatically. Unreviewed
drafts remain candidates. Review history and metadata/path/hash for every
current artifact project into the existing Desktop task, work-case, evidence,
artifact, preview, and inspector consumers rather than creating a second UI or
task system.

Bridge idempotency stores the original receipt atomically with the capability
review. The replay-only binding is excluded from projection identity, so replay
after unrelated work advances returns the same immutable snapshot and state
bindings without a second commit. Persisted before/after snapshot IDs carry and
recompute all 256 state-hash bits during restart validation.

## Consequences

- G2 and G3 now have one canonical identity and evidence chain across Core and
  Desktop.
- Carrier choice can change without changing facts, capability semantics, or
  teacher review policy.
- Strict persisted-state checks may reject malformed legacy or hand-edited
  files instead of attempting repair. Recovery is explicit and evidence-led.
- Fact v1 and the capability state are deliberately bounded to G1/G2/G3. This
  ADR does not authorize a general knowledge graph or bulk skill migration.
- Existing stores and skills remain available for compatibility and rollback;
  Task 16 kill decisions are advisory until their replacement gates pass.

## Rollback

The bridge additions are optional. With no `education_facts_v1.json` or
`capability_work_state.json`, the v1.1 education workspace keeps its legacy
shape and behavior. Rollback stops routing new G2/G3 work, retains source,
facts, receipts, artifacts, and audit records, and restores the previously
pinned component manifest. It does not delete teacher data or historical
evidence.

## Evidence boundary

Tasks 9-16 provide deterministic local E2 evidence for the G2/G3 slices,
including restart, stale source, retry, review, projection, and browser checks.
A branded test-only G3 activation proves the real supervised daemon timer and
review bridge; the ordinary production timer remains `activation_pending`.
Provider, network, channel, and external delivery remain inactive.

Task 17 supplies the scorecard contract and runbook but remains
`evidence_pending`: no fixture, screenshot, or model assessment counts as a
real-teacher run. Each claimed run must resolve an independently registered,
contained evidence file; material bytes must match their hash, and teacher
decision, restart, failure, reject, and withdraw evidence must all verify.
Product-wide L4 and E5 additionally require measured baseline/review time and
the teacher's decision.
