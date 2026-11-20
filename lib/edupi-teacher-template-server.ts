import { resolveEduPiBridgeRoots, readEduPiEducationSnapshot, type EduPiBridgeRoots } from "./edupi-core-snapshot";
import { clearEduPiRuntimeQuarantine, ensureEduPiRuntime, getActiveEduPiRuntime, quarantineEduPiRuntime, restartEduPiRuntime, type EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { readEduPiTeacherTemplateConfig, validTeacherTemplateScope, EduPiTeacherTemplateError } from "./edupi-teacher-template-config";
import { ownerForSelectedTemplate, pauseEduPiTeacherTemplateGrant, prepareEduPiTeacherTemplateGrant, teacherTemplateTaskId } from "./edupi-teacher-template-runtime";
import { resolveEduPiDataRoot } from "./edupi-core-root";
import { assertTeacherTemplateStorage } from "./edupi-teacher-template-storage";

export type TeacherTemplateSelection = { clientRequestId: string; scope: { classId: string; subject: string }; untilDate: string };
type Dependencies = {
  roots?: () => EduPiBridgeRoots;
  runtime?: (roots: EduPiBridgeRoots) => Promise<EduPiRuntimeHandle>;
  restart?: (roots: EduPiBridgeRoots) => Promise<EduPiRuntimeHandle>;
  readSnapshot?: typeof readEduPiEducationSnapshot;
  dataRoot?: () => string;
  active?: typeof getActiveEduPiRuntime;
  fence?: typeof quarantineEduPiRuntime;
  clearFence?: typeof clearEduPiRuntimeQuarantine;
  assertStorage?: typeof assertTeacherTemplateStorage;
};
const fail = (code: ConstructorParameters<typeof EduPiTeacherTemplateError>[0]): never => { throw new EduPiTeacherTemplateError(code); };
async function rootRef(host: EduPiRuntimeHandle): Promise<string> {
  const health = await host.call("health", null);
  const result = health.result as Record<string, unknown> | undefined;
  if (health.ok !== true || typeof result?.data_root_fingerprint !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(result.data_root_fingerprint)) fail("teacher_template_response_invalid");
  return result!.data_root_fingerprint as string;
}

/** This API creates no template or model output. It records only the teacher's explicit selection. */
export async function selectTeacherTemplateForCreation(input: TeacherTemplateSelection, dependencies: Dependencies = {}) {
  const templateId = teacherTemplateTaskId(input.clientRequestId);
  const scope = { class_id: input.scope.classId, subject: input.scope.subject };
  if (!validTeacherTemplateScope(scope) || !/^\d{4}-\d{2}-\d{2}$/u.test(input.untilDate)) fail("teacher_template_invalid_input");
  const until = new Date(`${input.untilDate}T23:59:59.999Z`);
  if (!Number.isFinite(until.valueOf()) || until.toISOString().slice(0, 10) !== input.untilDate) fail("teacher_template_invalid_input");
  const roots = (dependencies.roots ?? resolveEduPiBridgeRoots)(), options = { dataRoot: roots.dataRoot.root };
  const { config, status } = readEduPiTeacherTemplateConfig(options);
  if (status !== "missing" && status !== "ready") fail("teacher_template_configuration_unavailable");
  const previous = config?.binding;
  if (previous && (previous.scope.class_id !== scope.class_id || previous.scope.subject !== scope.subject)) {
    fail("teacher_template_config_conflict");
  }
  const host = await (dependencies.runtime ?? ensureEduPiRuntime)(roots);
  const reference = await rootRef(host);
  await (dependencies.assertStorage ?? assertTeacherTemplateStorage)(roots, reference);
  if (config?.enabled && previous?.templateIds.includes(templateId)) {
    if (await ownerForSelectedTemplate(host, templateId, { ...options, rootRef: reference }) !== previous.ownerId) {
      fail("teacher_template_grant_denied");
    }
    return { templateId, ownerId: previous.ownerId };
  }
  // Check a new selection against the actual Core entity projection. Renderer
  // labels and arbitrary class strings cannot establish a canonical class ID.
  const snapshot = await (dependencies.readSnapshot ?? readEduPiEducationSnapshot)({ roots });
  const spine = snapshot.workspace.fact_spine as { entities?: Array<Record<string, unknown>> } | undefined;
  if (!spine?.entities?.some(entity => entity.entity_id === scope.class_id && entity.entity_kind === "class"
    && entity.status === "active")) fail("teacher_template_invalid_input");
  const templateIds = [...(previous?.templateIds ?? []), templateId].filter((id, index, all) => all.indexOf(id) === index);
  const grant = await prepareEduPiTeacherTemplateGrant(host, { templateIds, scope,
    endsAt: until.toISOString() }, { ...options, rootRef: reference, expectedUpdatedAt: config?.updatedAt ?? null });
  const restarted = await (dependencies.restart ?? restartEduPiRuntime)(roots);
  const restartedRef = await rootRef(restarted);
  if (restartedRef !== reference || await ownerForSelectedTemplate(restarted, templateId,
    { ...options, rootRef: reference }) !== grant.binding.ownerId) fail("teacher_template_grant_denied");
  return { templateId, ownerId: grant.binding.ownerId };
}

/** A stop requires only the private data root. Missing Core must never prevent the durable local fence. */
export async function stopTeacherTemplates(expectedUpdatedAt: string | null, dependencies: Dependencies = {}) {
  const dataRoot = (dependencies.dataRoot ?? (() => resolveEduPiDataRoot().root))();
  const active = (dependencies.active ?? getActiveEduPiRuntime)(dataRoot);
  let host: EduPiRuntimeHandle | null = null, fenced = false;
  // This identity was verified at managed-host admission. With no admitted
  // identity the remote result stays unknown; local persistence still succeeds.
  const reference = active?.dataRootFingerprint ?? "";
  const stoppedHost = async () => {
    if (!fenced) fail("teacher_template_owner_unavailable");
    if (!host) {
      (dependencies.clearFence ?? clearEduPiRuntimeQuarantine)(dataRoot);
      const roots = (dependencies.roots ?? resolveEduPiBridgeRoots)();
      if (roots.dataRoot.root !== dataRoot) fail("teacher_template_configuration_unavailable");
      host = await (dependencies.runtime ?? ensureEduPiRuntime)(roots);
      if (await rootRef(host) !== reference) fail("teacher_template_response_invalid");
    }
    return host;
  };
  const transport = {
    async call(operation: string, payload: unknown, signal?: AbortSignal) {
      return (await stoppedHost()).call(operation, payload, signal);
    },
    async callOwnerControl(operation: string, payload: unknown, signal?: AbortSignal) {
      return (await stoppedHost()).callOwnerControl(operation, payload, signal);
    },
  };
  const stopped = await pauseEduPiTeacherTemplateGrant(transport, { dataRoot, rootRef: reference, expectedUpdatedAt,
    onLocalStop: async () => {
      await (dependencies.fence ?? quarantineEduPiRuntime)(dataRoot, { requireClosed: true });
      fenced = true;
    } });
  let runtimeStatus = stopped.runtimeStatus;
  if (host && runtimeStatus === "verified") {
    // The remote pause persists a new config revision. Retire the temporary
    // template-free host admitted at the earlier revision before reporting.
    try { await (dependencies.fence ?? quarantineEduPiRuntime)(dataRoot, { requireClosed: true }); }
    catch { runtimeStatus = "unknown"; }
  }
  // If remote inspection was unnecessary or unavailable, release the verified
  // local quarantine with the durable configuration still off.
  if (runtimeStatus === "verified") {
    (dependencies.clearFence ?? clearEduPiRuntimeQuarantine)(dataRoot);
  }
  const latest = readEduPiTeacherTemplateConfig({ dataRoot });
  if (latest.status !== "ready" || !latest.config) return fail("teacher_template_configuration_unavailable");
  if (latest.config.updatedAt !== stopped.config.updatedAt || latest.config.enabled) fail("teacher_template_config_conflict");
  if (stopped.localStatus === "superseded") fail("teacher_template_config_conflict");
  if (stopped.localStatus !== "disabled") fail("teacher_template_configuration_unavailable");
  return { version: 1 as const, enabled: false, updatedAt: stopped.config.updatedAt,
    localStatus: stopped.localStatus, runtimeStatus, coreStatus: stopped.coreStatus };
}
