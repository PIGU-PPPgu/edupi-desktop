import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiProactivityActivation } from "@/lib/edupi-proactivity-config";
import { proactivityConversationId } from "@/lib/edupi-proactivity-control";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { registerAndCapturePrompt } from "@/lib/edupi-registered-prompt";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";
import { canStartEduPiCapabilityDrafts } from "@/lib/safe-mode";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:@/+~-]{0,159}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const JOURNAL_DIRECTORY = "edupi-parent-question-confirmations-v1";
const MAX_JOURNAL_BYTES = 16 * 1024;
type ObjectValue = Record<string, unknown>;
type Candidate = { case_id: string; question_fact_id: string; question_revision: number; student_id: string;
  recipient_id: string; term_ref: string; scope: { class_id: string; subject: string };
  deadline_at: string; grant_version: number; source_basis_hash: string;
  confirmation_plan_id: string; confirmation_text: string; confirmed_fact_id: string | null; message_ref: string | null };
type Journal = { version: 1 | 2; rootRef: string; ownerId: string; grantId: string; questionFactId: string;
  questionRevision: number; generation: number; sourceBasisHash: string; planId: string; messageId: string; occurredAt: string;
  commandId: string; confirmationText: string; candidate: Candidate; messageRef: string | null;
  confirmedFactId?: string; confirmedFactRevision?: number;
  stage: "prepared" | "registered" | "captured" | "cancel_pending" | "cancelled" };

const object = (value: unknown): ObjectValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const reply = (body: ObjectValue, status = 200) => NextResponse.json({ ...body, externalSend: false }, { status, headers: { "Cache-Control": "no-store" } });
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const comparableConfirmation = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "");
const messageId = (factId: string, revision: number, generation: number) => `parent-question-${hash(`${factId}\0${revision}\0${generation}`)}`;
const commandId = (action: string, factId: string, basis: string, generation: number) => `parent-question-${action}-${hash(`${factId}\0${basis}\0${generation}`)}`;
const readInput = (rootRef: string, ownerId: string, grantId: string, factId: string, revision: number, generation: number) => ({
  root_ref: rootRef, expected_owner_id: ownerId, grant_id: grantId, question_fact_id: factId,
  conversation_id: proactivityConversationId("parent_communication"), message_id: messageId(factId, revision, generation),
});

function candidate(value: unknown): Candidate | null {
  const item = object(value);
  const scope = object(item?.scope);
  if (!item || !ID.test(String(item.case_id)) || !ID.test(String(item.question_fact_id))
    || !ID.test(String(item.student_id)) || !ID.test(String(item.recipient_id)) || !ID.test(String(item.term_ref))
    || !scope || !ID.test(String(scope.class_id)) || typeof scope.subject !== "string" || !scope.subject.trim() || scope.subject.length > 128
    || typeof item.deadline_at !== "string" || !Number.isFinite(Date.parse(item.deadline_at))
    || new Date(item.deadline_at).toISOString() !== item.deadline_at
    || !Number.isSafeInteger(item.question_revision) || Number(item.question_revision) < 1
    || !Number.isSafeInteger(item.grant_version) || Number(item.grant_version) < 1 || !HASH.test(String(item.source_basis_hash))
    || !ID.test(String(item.confirmation_plan_id)) || typeof item.confirmation_text !== "string"
    || !item.confirmation_text.trim() || item.confirmation_text.length > 500
    || item.confirmed_fact_id !== null && !ID.test(String(item.confirmed_fact_id))
    || item.message_ref !== null && !MESSAGE_REF.test(String(item.message_ref))) return null;
  return item as Candidate;
}

function checkedRead(value: unknown, factId: string, revision: number): { status: "held" | "needs_confirmation" | "confirmed"; candidate: Candidate | null } {
  const response = object(value), result = object(response?.result);
  if (response?.ok !== true || !result || result.version !== 1 || !["held", "needs_confirmation", "confirmed"].includes(String(result.status))
    || result.fact_write !== false || result.model_execute !== false || result.live_authority !== false || result.external_send !== false) throw new Error("recipient_read_unavailable");
  const proof = result.candidate === null ? null : candidate(result.candidate);
  if (result.status === "held" ? result.candidate !== null : !proof || proof.question_fact_id !== factId || proof.question_revision !== revision
    || result.status === "confirmed" && (!proof.confirmed_fact_id || !proof.message_ref)) throw new Error("recipient_read_invalid");
  return { status: result.status as "held" | "needs_confirmation" | "confirmed", candidate: proof };
}

function journalDirectory(create = true): string | null {
  const root = process.env.PI_DESKTOP_STATE_DIR;
  if (!root || !path.isAbsolute(root)) throw new Error("recipient_journal_unavailable");
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o022) !== 0
    || typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("recipient_journal_unavailable");
  const dir = path.join(fs.realpathSync(root), JOURNAL_DIRECTORY);
  if (create) {
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } else if (!fs.existsSync(dir)) return null;
  const child = fs.lstatSync(dir);
  if (!child.isDirectory() || child.isSymbolicLink() || process.platform !== "win32" && ((child.mode & 0o077) !== 0
    || typeof process.getuid === "function" && child.uid !== process.getuid())) throw new Error("recipient_journal_unavailable");
  return fs.realpathSync(dir);
}

function journalPath(dir: string, rootRef: string, factId: string, revision: number, basis: string, generation: number): string {
  return path.join(dir, `${hash(`${rootRef}\0${factId}\0${revision}\0${basis}\0${generation}`)}.json`);
}

function readJournal(file: string): Journal | null {
  let descriptor: number;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_JOURNAL_BYTES || process.platform !== "win32" && ((stat.mode & 0o077) !== 0
      || typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("recipient_journal_unavailable");
    const item = object(JSON.parse(fs.readFileSync(descriptor, "utf8")));
    const proof = candidate(item?.candidate);
    if (!item || item.version !== 1 && item.version !== 2 || !HASH.test(String(item.rootRef)) || !ID.test(String(item.ownerId)) || !ID.test(String(item.grantId))
      || !ID.test(String(item.questionFactId)) || !Number.isSafeInteger(item.questionRevision) || Number(item.questionRevision) < 1
      || !Number.isSafeInteger(item.generation) || Number(item.generation) < 0 || Number(item.generation) > 500
      || !HASH.test(String(item.sourceBasisHash)) || !ID.test(String(item.planId)) || !ID.test(String(item.messageId))
      || typeof item.occurredAt !== "string" || new Date(item.occurredAt).toISOString() !== item.occurredAt
      || !ID.test(String(item.commandId)) || typeof item.confirmationText !== "string" || !item.confirmationText.trim() || item.confirmationText.length > 500
      || !proof || (item.version === 1 ? item.confirmationText !== proof.confirmation_text
        : comparableConfirmation(item.confirmationText) !== comparableConfirmation(proof.confirmation_text)) || item.questionFactId !== proof.question_fact_id
      || item.questionRevision !== proof.question_revision || item.sourceBasisHash !== proof.source_basis_hash
      || item.planId !== proof.confirmation_plan_id || item.messageId !== messageId(String(item.questionFactId), Number(item.questionRevision), Number(item.generation))
      || item.commandId !== commandId("confirm", String(item.questionFactId), String(item.sourceBasisHash), Number(item.generation))
      || item.messageRef !== null && !MESSAGE_REF.test(String(item.messageRef))
      || Object.hasOwn(item, "confirmedFactId") && !ID.test(String(item.confirmedFactId))
      || Object.hasOwn(item, "confirmedFactRevision") && (!Number.isSafeInteger(item.confirmedFactRevision) || Number(item.confirmedFactRevision) < 1)
      || Object.hasOwn(item, "confirmedFactRevision") && !Object.hasOwn(item, "confirmedFactId")
      || !["prepared", "registered", "captured", "cancel_pending", "cancelled"].includes(String(item.stage))
      || ["captured", "cancel_pending", "cancelled"].includes(String(item.stage)) && !item.messageRef) throw new Error("recipient_journal_unavailable");
    return item as Journal;
  } finally { fs.closeSync(descriptor); }
}

function saveJournal(file: string, item: Journal): void {
  const serialized = `${JSON.stringify(item)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_BYTES) throw new Error("recipient_journal_unavailable");
  writePrivateFileAtomicSync(file, serialized);
}

async function runtimeContext() {
  const roots = resolveEduPiBridgeRoots();
  const host = await ensureEduPiRuntime(roots);
  const health = object(object(await host.call("health", null))?.result), capabilities = object(health?.capabilities);
  const rootRef = health?.data_root_fingerprint;
  if (!HASH.test(String(rootRef))) throw new Error("recipient_runtime_unavailable");
  const capacity = object(health?.owner_message_capacity);
  const ownerHistoryV3 = capacity?.record_limit === 512 || capacity?.storage === "sqlite_stream_v1" && capacity.record_limit === null;
  const response = await host.callOwnerControl("owner_read", { root_ref: rootRef });
  const state = object(response.result), owner = object(state?.owner);
  if (response.ok !== true || !ID.test(String(owner?.id))) throw new Error("recipient_owner_unavailable");
  return { roots, host, rootRef: String(rootRef), ownerId: String(owner?.id), grants: Array.isArray(state?.grants) ? state.grants : [],
    g3Active: capabilities?.g3_processor === "active", messageRegistrationActive: capabilities?.owner_message_registration === "active", ownerHistoryV3 };
}

function activeContext(base: Awaited<ReturnType<typeof runtimeContext>>) {
  const activation = readEduPiProactivityActivation({ dataRoot: base.roots.dataRoot.root, domain: "parent_communication" });
  if (!base.g3Active || !base.messageRegistrationActive || !base.ownerHistoryV3 || !activation.enabled || !activation.grantId || !activation.scope || !activation.ownerId) return null;
  const { ownerId } = base;
  const state = { grants: base.grants };
  const grant = Array.isArray(state?.grants) ? state.grants.map(object).find(item => item?.id === activation.grantId) : null;
  const scope = object(grant?.scope);
  if (ownerId !== activation.ownerId || grant?.status !== "active" || !Number.isSafeInteger(grant.version)
    || scope?.class_id !== activation.scope.classId || scope?.subject !== activation.scope.subject) return null;
  return { ...base, grantId: activation.grantId, grantVersion: Number(grant.version), scope: activation.scope };
}

async function acceptedFacts(roots: ReturnType<typeof resolveEduPiBridgeRoots>) {
  const snapshot = await readEduPiEducationSnapshot({ roots });
  const spine = object(snapshot.workspace.fact_spine);
  if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false
    || !Array.isArray(spine.accepted_facts) || !Array.isArray(spine.observations)) throw new Error("recipient_sources_unavailable");
  const facts = spine.accepted_facts.map(object).filter((item): item is ObjectValue => Boolean(item && item.status === "accepted"
    && ID.test(String(item.fact_id)) && Number.isSafeInteger(item.revision) && Number(item.revision) > 0));
  const observations = new Map(spine.observations.map(object).filter((item): item is ObjectValue => Boolean(item && ID.test(String(item.observation_id))))
    .map(item => [String(item.observation_id), item]));
  return { facts, observations };
}

function currentQuestions(spine: Awaited<ReturnType<typeof acceptedFacts>>, scope: { classId: string; subject: string }) {
  const questions = spine.facts.filter(item => item.predicate === "communication.parent_question"
    && Array.isArray(item.observation_ids) && item.observation_ids.length > 0
    && item.observation_ids.every(id => {
      const source = spine.observations.get(String(id));
      return source?.status === "active" && Array.isArray(source.entity_ids) && source.entity_ids.includes(scope.classId);
    }));
  return questions;
}

function confirmedFact(facts: ObjectValue[], journal: Pick<Journal, "commandId" | "confirmedFactId">): ObjectValue | null {
  const sourceId = `parent_question_recipient:${hash(journal.commandId)}`;
  const matches = facts.filter(item => item.predicate === "communication.question_recipient_confirmed"
    && Array.isArray(item.source_ids) && item.source_ids.length === 1 && item.source_ids[0] === sourceId);
  if (matches.length > 1) throw new Error("recipient_confirmation_ambiguous");
  if (matches[0] && journal.confirmedFactId && matches[0].fact_id !== journal.confirmedFactId) throw new Error("recipient_confirmation_ambiguous");
  return matches[0] ?? null;
}

function confirmedGeneration(facts: ObjectValue[], proof: Candidate): number | null {
  for (let generation = 0; generation <= 500; generation++) {
    const fact = confirmedFact(facts, {
      commandId: commandId("confirm", proof.question_fact_id, proof.source_basis_hash, generation),
    });
    if (fact?.fact_id === proof.confirmed_fact_id) return generation;
  }
  return null;
}

function journalsForRoot(rootRef: string, ownerId: string): Journal[] {
  const dir = journalDirectory(false);
  if (!dir) return [];
  const names = fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).sort();
  return names.flatMap(name => {
    const item = readJournal(path.join(dir, name));
    if (item && name !== path.basename(journalPath(dir, item.rootRef, item.questionFactId, item.questionRevision, item.sourceBasisHash, item.generation))) {
      throw new Error("recipient_journal_unavailable");
    }
    return item && item.rootRef === rootRef && item.ownerId === ownerId ? [item] : [];
  });
}

async function selectedQuestion(host: Awaited<ReturnType<typeof runtimeContext>>["host"], rootRef: string, ownerId: string,
  grantId: string, factId: string, revision: number, journals: Journal[], facts: ObjectValue[]) {
  const related = journals.filter(item => item.questionFactId === factId && item.questionRevision === revision);
  let generation = related.length ? Math.max(...related.map(item => item.generation)) + 1 : 0;
  let selection = readInput(rootRef, ownerId, grantId, factId, revision, generation);
  let read = checkedRead(await host.callOwnerControl("owner_parent_question_recipient_read", selection), factId, revision);
  const previous = related.find(item => item.sourceBasisHash === read.candidate?.source_basis_hash
    && (read.status === "confirmed"
      ? ["captured", "cancel_pending"].includes(item.stage) && item.messageRef === read.candidate?.message_ref
        && item.planId === read.candidate?.confirmation_plan_id
      : ["prepared", "registered", "captured"].includes(item.stage)));
  if (previous) {
    generation = previous.generation;
    selection = readInput(rootRef, ownerId, grantId, factId, revision, generation);
    read = checkedRead(await host.callOwnerControl("owner_parent_question_recipient_read", selection), factId, revision);
  } else if (read.status === "confirmed" && read.candidate) {
    const recovered = confirmedGeneration(facts, read.candidate);
    if (recovered !== null) generation = recovered;
  }
  return { generation, selection, read };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  if (!canStartEduPiCapabilityDrafts()) return reply({ ok: true, entries: [] });
  try {
    const base = await runtimeContext();
    if (readEduPiProactivityActivation({ dataRoot: base.roots.dataRoot.root, domain: "parent_communication" }).enabled
      && !base.ownerHistoryV3) return reply({ ok: false, code: "owner_history_upgrade_required" }, 409);
    const active = activeContext(base);
    const spine = await acceptedFacts(base.roots), entries = [];
    const journals = journalsForRoot(base.rootRef, base.ownerId);
    if (active) for (const fact of currentQuestions(spine, active.scope)) {
      const id = String(fact.fact_id), revision = Number(fact.revision);
      const { generation, read } = await selectedQuestion(base.host, base.rootRef, base.ownerId, active.grantId, id, revision, journals, spine.facts);
      if (read.status !== "held" && read.candidate) {
        entries.push({ questionFactId: id, questionRevision: revision,
          messageGeneration: generation, status: read.status, candidate: read.candidate });
      }
    }
    const historical = [];
    for (const journal of journals.filter(item => ["captured", "cancel_pending"].includes(item.stage))) {
      const confirmed = confirmedFact(spine.facts, journal);
      if (!confirmed && !journal.confirmedFactId || entries.some(item => item.status === "confirmed" && item.questionFactId === journal.questionFactId
        && item.candidate.source_basis_hash === journal.sourceBasisHash)) continue;
      historical.push({ questionFactId: journal.questionFactId, questionRevision: journal.questionRevision,
        messageGeneration: journal.generation,
        status: "stale_confirmed", candidate: { ...journal.candidate, confirmed_fact_id: String(journal.confirmedFactId ?? confirmed?.fact_id), message_ref: journal.messageRef } });
    }
    entries.sort((left, right) => Number(right.status === "confirmed") - Number(left.status === "confirmed"));
    const current = entries.slice(0, 128 - Math.min(historical.length, entries.length ? 127 : 128));
    return reply({ ok: true, entries: [...current, ...historical.slice(0, 128 - current.length)] });
  } catch { return reply({ ok: false, error: "家长问题确认暂不可用" }, 503); }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  if (!canStartEduPiCapabilityDrafts()) return reply({ ok: false }, 409);
  try {
    const input = object(await parseJsonWithinLimit(request, 2048));
    const confirmation = input?.action === "confirm";
    if (!input || Object.keys(input).length !== (confirmation ? 7 : 6)
      || !["action", "questionFactId", "questionRevision", "messageGeneration", "sourceBasisHash", "confirmationPlanId", ...(confirmation ? ["confirmationText"] : [])].every(key => Object.hasOwn(input, key))
      || !["confirm", "cancel"].includes(String(input.action)) || !ID.test(String(input.questionFactId))
      || !Number.isSafeInteger(input.questionRevision) || Number(input.questionRevision) < 1
      || !Number.isSafeInteger(input.messageGeneration) || Number(input.messageGeneration) < 0 || Number(input.messageGeneration) > 500
      || !HASH.test(String(input.sourceBasisHash)) || !ID.test(String(input.confirmationPlanId))
      || confirmation && (typeof input.confirmationText !== "string" || !input.confirmationText.trim() || input.confirmationText.length > 500)) return reply({ ok: false }, 400);
    const factId = String(input.questionFactId), revision = Number(input.questionRevision), generation = Number(input.messageGeneration);
    return await withEduPiAmbientSessionLock(`parent-question-${hash(factId)}`, async () => {
      const base = await runtimeContext();
      const { roots, host, rootRef, ownerId } = base;
      const spine = await acceptedFacts(roots);
      if (input.action === "cancel") {
        let dir = journalDirectory(false);
        let file = dir ? journalPath(dir, rootRef, factId, revision, String(input.sourceBasisHash), generation) : null;
        let saved = file ? readJournal(file) : null;
        if (!saved) {
          const active = activeContext(base);
          if (!active || !currentQuestions(spine, active.scope).some(fact => fact.fact_id === factId && fact.revision === revision)) {
            return reply({ ok: false, code: "source_unavailable" }, 409);
          }
          const read = checkedRead(await host.callOwnerControl("owner_parent_question_recipient_read",
            readInput(rootRef, ownerId, active.grantId, factId, revision, generation)), factId, revision);
          const proof = read.candidate;
          if (read.status !== "confirmed" || !proof || proof.source_basis_hash !== input.sourceBasisHash
            || proof.confirmation_plan_id !== input.confirmationPlanId || proof.grant_version !== active.grantVersion
            || confirmedGeneration(spine.facts, proof) !== generation) return reply({ ok: false, code: "source_unavailable" }, 409);
          dir = journalDirectory();
          if (!dir) throw new Error("recipient_journal_unavailable");
          file = journalPath(dir, rootRef, factId, revision, proof.source_basis_hash, generation);
          saved = { version: 2, rootRef, ownerId, grantId: active.grantId, questionFactId: factId, questionRevision: revision,
            generation, sourceBasisHash: proof.source_basis_hash, planId: proof.confirmation_plan_id,
            messageId: messageId(factId, revision, generation), occurredAt: new Date().toISOString(),
            commandId: commandId("confirm", factId, proof.source_basis_hash, generation),
            confirmationText: proof.confirmation_text, candidate: proof, messageRef: proof.message_ref,
            confirmedFactId: proof.confirmed_fact_id!, stage: "cancel_pending" };
        }
        if (!saved || saved.rootRef !== rootRef || saved.ownerId !== ownerId || saved.questionFactId !== factId
          || saved.questionRevision !== revision || saved.sourceBasisHash !== input.sourceBasisHash || saved.generation !== generation
          || !["captured", "cancel_pending"].includes(saved.stage) || !saved.messageRef
          || saved.planId !== input.confirmationPlanId
          || saved.stage === "captured" && !saved.confirmedFactId && !confirmedFact(spine.facts, saved)) return reply({ ok: false, code: "source_unavailable" }, 409);
        const visible = confirmedFact(spine.facts, saved);
        const messageRef = saved.messageRef;
        const expectedFact = saved.confirmedFactId ?? String(visible?.fact_id ?? "");
        if (!ID.test(expectedFact)) return reply({ ok: false, code: "source_unavailable" }, 409);
        saved = { ...saved, confirmedFactId: expectedFact,
          ...(visible ? { confirmedFactRevision: Number(visible.revision) } : {}), stage: "cancel_pending" };
        saveJournal(file!, saved);
        const response = await host.callOwnerControl("owner_parent_question_recipient_cancel", {
          root_ref: rootRef, expected_owner_id: ownerId, grant_id: saved.grantId, question_fact_id: factId,
          command_id: commandId("cancel", factId, messageRef, generation), message_ref: messageRef,
        });
        const cancelled = object(response.result);
        const after = await acceptedFacts(roots);
        if (response.ok !== true || !cancelled || cancelled.version !== 1 || !["cancelled", "replayed"].includes(String(cancelled.status))
          || cancelled.question_fact_id !== factId || cancelled.message_ref !== saved.messageRef
          || cancelled.fact_id !== expectedFact || !Number.isSafeInteger(cancelled.fact_revision) || Number(cancelled.fact_revision) < 1
          || saved.confirmedFactRevision && Number(cancelled.fact_revision) <= saved.confirmedFactRevision
          || cancelled.source_basis_hash !== saved.sourceBasisHash || cancelled.fact_write !== true
          || cancelled.external_send !== false || cancelled.model_execute !== false || cancelled.live_authority !== false
          || confirmedFact(after.facts, saved)) throw new Error("recipient_cancel_unverified");
        saveJournal(file!, { ...saved, stage: "cancelled" });
        return reply({ ok: true, status: "cancelled", readbackConfirmed: true });
      }
      const active = activeContext(base);
      if (!active || !currentQuestions(spine, active.scope).some(fact => fact.fact_id === factId && fact.revision === revision)) return reply({ ok: false, code: "source_unavailable" }, 409);
      const journals = journalsForRoot(rootRef, ownerId);
      const { grantId, grantVersion } = active;
      const selection = readInput(rootRef, ownerId, grantId, factId, revision, generation);
      const before = checkedRead(await host.callOwnerControl("owner_parent_question_recipient_read", selection), factId, revision);
      const proof = before.candidate;
      if (!proof || proof.source_basis_hash !== input.sourceBasisHash || proof.confirmation_plan_id !== input.confirmationPlanId
        || proof.grant_version !== grantVersion) return reply({ ok: false, code: "stale_source" }, 409);
      if (comparableConfirmation(String(input.confirmationText)) !== comparableConfirmation(proof.confirmation_text)) {
        return reply({ ok: false, code: "confirmation_text_mismatch" }, 409);
      }
      const related = journals.filter(item => item.questionFactId === factId && item.questionRevision === revision);
      const current = related.find(item => item.sourceBasisHash === proof.source_basis_hash
        && ["prepared", "registered", "captured"].includes(item.stage));
      if (before.status !== "needs_confirmation" && (before.status !== "confirmed" || current?.stage !== "captured"
        || current.messageRef !== proof.message_ref || confirmedFact(spine.facts, current)?.fact_id !== proof.confirmed_fact_id)) {
        return reply({ ok: false, code: "source_unavailable" }, 409);
      }
      if (current ? current.generation !== generation : generation !== (related.length ? Math.max(...related.map(item => item.generation)) + 1 : 0)) {
        return reply({ ok: false, code: "stale_source" }, 409);
      }
      const dir = journalDirectory();
      if (!dir) throw new Error("recipient_journal_unavailable");
      const file = journalPath(dir, rootRef, factId, revision, proof.source_basis_hash, generation);
      const expected: Journal = { version: 2, rootRef, ownerId, grantId, questionFactId: factId, questionRevision: revision, generation,
        sourceBasisHash: proof.source_basis_hash, planId: proof.confirmation_plan_id, messageId: selection.message_id,
        occurredAt: new Date().toISOString(), commandId: commandId("confirm", factId, proof.source_basis_hash, generation),
        confirmationText: String(input.confirmationText), candidate: proof, messageRef: null, stage: "prepared" };
      let journal = readJournal(file);
      if (journal && (journal.rootRef !== rootRef || journal.ownerId !== ownerId || journal.grantId !== grantId
        || journal.questionFactId !== factId || journal.questionRevision !== revision || journal.sourceBasisHash !== proof.source_basis_hash
        || journal.planId !== proof.confirmation_plan_id || journal.messageId !== selection.message_id
        || comparableConfirmation(journal.confirmationText) !== comparableConfirmation(String(input.confirmationText)))) {
        throw new Error("recipient_journal_conflict");
      }
      if (!journal) { saveJournal(file, expected); journal = expected; }
      if (journal.stage !== "captured") {
        const saved = journal;
        await registerAndCapturePrompt(host, { rootRef, grantId, sessionId: `parent-question-${hash(factId)}`,
          messageId: saved.messageId, text: saved.confirmationText, occurredAt: saved.occurredAt,
          domain: "parent_communication", carrierId: "edupi.desktop.parent_question", planId: saved.planId,
          previousBinding: { ownerId, grantId, grantVersion } }, {
          onBound: () => { throw new Error("recipient_grant_changed"); },
          onRegistered: registration => {
            if (saved.messageRef && saved.messageRef !== registration.messageRef) throw new Error("recipient_message_changed");
            journal = { ...saved, messageRef: registration.messageRef, stage: "registered" };
            saveJournal(file, journal);
          },
          onCaptured: capture => {
            journal = { ...journal!, messageRef: capture.messageRef, stage: "captured" };
            saveJournal(file, journal);
          },
        });
      }
      if (!journal.messageRef || journal.stage !== "captured") throw new Error("recipient_capture_unverified");
      const response = await host.callOwnerControl("owner_parent_question_recipient_confirm", {
        ...selection, command_id: journal.commandId, message_ref: journal.messageRef,
        expected_source_basis_hash: journal.sourceBasisHash,
      });
      const result = object(response.result);
      const committed = await acceptedFacts(roots);
      const visible = confirmedFact(committed.facts, journal);
      if (response.ok !== true || !result || result.version !== 1 || !["confirmed", "replayed", "held"].includes(String(result.status))
        || result.case_id !== proof.case_id || !ID.test(String(result.fact_id))
        || !Number.isSafeInteger(result.fact_revision) || Number(result.fact_revision) < 1
        || result.fact_write !== true || result.external_send !== false || result.model_execute !== false || result.live_authority !== false
        || result.message_ref !== journal.messageRef || result.source_basis_hash !== journal.sourceBasisHash
        || visible && visible.fact_id !== result.fact_id) throw new Error("recipient_confirm_unverified");
      journal = { ...journal, confirmedFactId: String(result.fact_id), confirmedFactRevision: Number(result.fact_revision) };
      saveJournal(file, journal);
      const after = checkedRead(await host.callOwnerControl("owner_parent_question_recipient_read", selection), factId, revision);
      if (result.status === "held" || after.status === "held") return reply({ ok: false, code: "partial_commit" }, 409);
      if (after.status !== "confirmed" || after.candidate?.confirmed_fact_id !== result.fact_id
        || after.candidate?.message_ref !== journal.messageRef) throw new Error("recipient_confirm_unverified");
      return reply({ ok: true, status: "confirmed", readbackConfirmed: true });
    });
  } catch (error) {
    return reply({ ok: false, error: "家长问题确认暂不可用" }, error instanceof RequestBodyTooLargeError ? 413 : 503);
  }
}
