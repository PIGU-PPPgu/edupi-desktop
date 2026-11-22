import type { EducationContract } from "./edupi-education-contract";
import type { TeacherContextSnapshot } from "./edupi-onboarding-types";

type EducationResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

type EducationFetcher = (url: string, init?: { cache?: RequestCache; signal?: AbortSignal }) => Promise<EducationResponse>;

export type EduPiWorkspaceBundle = { context: TeacherContextSnapshot; data: EducationContract };
export type EduPiEducationScope = {
  mode: "local" | "cloud";
  accountId: string | null;
  workspaceId: string | null;
  generation?: number;
};

let workspaceScope: EduPiEducationScope = { mode: "local", accountId: null, workspaceId: null };
let workspaceScopeVersion = 0;
let lastReadWriteScope: { version: number; value: string | null } | null = null;
let inFlightWorkspaceRequest: {
  scope: EduPiEducationScope;
  version: number;
  controller: AbortController;
  promise: Promise<EduPiWorkspaceBundle>;
} | null = null;

export function getEduPiEducationScopeVersion(): number {
  return workspaceScopeVersion;
}

/** Capture the scope of displayed data before starting an asynchronous write. */
export function educationWriteHeaders(initial?: HeadersInit, scope?: string | null): Headers {
  const recorded = lastReadWriteScope?.version === workspaceScopeVersion ? lastReadWriteScope.value : null;
  const value = scope ?? recorded ?? (lastReadWriteScope === null && workspaceScope.mode === "local" ? "local" : null);
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw abortError();
  const headers = new Headers(initial);
  headers.set("x-edupi-cloud-scope", value);
  return headers;
}

export function updateEduPiEducationScope(next: EduPiEducationScope): boolean {
  const sameIdentity = workspaceScope.mode === next.mode
    && workspaceScope.accountId === next.accountId && workspaceScope.workspaceId === next.workspaceId;
  const generationChanged = next.generation !== undefined && next.generation !== workspaceScope.generation;
  workspaceScope = {
    ...next,
    generation: next.generation ?? (sameIdentity ? workspaceScope.generation : undefined),
  };
  if (sameIdentity && !generationChanged) return false;
  workspaceScopeVersion++;
  const previous = inFlightWorkspaceRequest;
  inFlightWorkspaceRequest = null;
  previous?.controller.abort();
  return true;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function waitForCaller<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function readEduPiWorkspace({
  fetcher = fetch as unknown as EducationFetcher,
  signal,
}: {
  fetcher?: EducationFetcher;
  signal?: AbortSignal;
} = {}): Promise<EduPiWorkspaceBundle> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!inFlightWorkspaceRequest) {
    const version = workspaceScopeVersion;
    const controller = new AbortController();
    const pipeline = fetcher("/api/edupi/workspace", { cache: "no-store", signal: controller.signal }).catch(() => {
      if (controller.signal.aborted) throw abortError();
      throw new Error("教育工作区暂不可用，请重试");
    }).then(async (response) => {
      if (controller.signal.aborted || version !== workspaceScopeVersion) throw abortError();
      if (!response.ok) {
        let message: string | null = null;
        try {
          const problem = await response.json() as { error?: unknown } | null;
          if (typeof problem?.error === "string" && problem.error.trim()
            && problem.error.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(problem.error)) message = problem.error;
        } catch { /* Keep the HTTP fallback for malformed error responses. */ }
        if (controller.signal.aborted || version !== workspaceScopeVersion) throw abortError();
        throw new Error(message || `教育工作区读取失败（HTTP ${response.status ?? "unknown"}）`);
      }
      const bundle = await response.json() as EduPiWorkspaceBundle;
      if (controller.signal.aborted || version !== workspaceScopeVersion) throw abortError();
      if (!bundle?.context || !bundle?.data) throw new Error("教育工作区数据无效。");
      const cloudScope = bundle.data.cloudScope;
      lastReadWriteScope = { version, value: typeof cloudScope === "string" && cloudScope
        ? cloudScope : workspaceScope.mode === "local"
          ? workspaceScope.generation === undefined ? "local" : JSON.stringify(["local", workspaceScope.generation])
          : null };
      return bundle;
    });
    const request = new Promise<EduPiWorkspaceBundle>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      controller.signal.addEventListener("abort", onAbort, { once: true });
      void pipeline.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", onAbort));
    });
    inFlightWorkspaceRequest = { scope: { ...workspaceScope }, version, controller, promise: request };
    void request.finally(() => {
      if (inFlightWorkspaceRequest?.promise === request) inFlightWorkspaceRequest = null;
    }).catch(() => {});
  }
  return waitForCaller(inFlightWorkspaceRequest.promise, signal);
}

export async function readEduPiEducation(options: { fetcher?: EducationFetcher; signal?: AbortSignal } = {}): Promise<EducationContract> {
  return (await readEduPiWorkspace(options)).data;
}

export function preserveUnavailableWorkspaceResources(previous: EducationContract, next: EducationContract, { removedMaterialId = null }: { removedMaterialId?: string | null } = {}): EducationContract {
  if (!next.workspaceResourcesUnavailable) return next;
  const previousStudents = new Map(previous.students.map((student) => [student.student_id, student]));
  return {
    ...next,
    students: next.students.map((student) => {
      const prior = previousStudents.get(student.student_id);
      return !student.class_name && prior?.class_name ? { ...student, class_name: prior.class_name } : student;
    }),
    studentNameCounts: previous.studentNameCounts,
    teacherMaterials: previous.teacherMaterials?.filter((material) => material.material_id !== removedMaterialId),
    generatedArtifacts: previous.generatedArtifacts,
  };
}

export function resetEduPiEducationRequestForTest(): void {
  inFlightWorkspaceRequest?.controller.abort();
  inFlightWorkspaceRequest = null;
  workspaceScope = { mode: "local", accountId: null, workspaceId: null };
  lastReadWriteScope = null;
  workspaceScopeVersion++;
}
