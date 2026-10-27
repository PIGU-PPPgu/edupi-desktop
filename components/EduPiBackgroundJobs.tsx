"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { buildMaterialRows } from "@/lib/edupi-material-rows";
import { openPathNative } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";

type Job = { job_id: string; title: string; status: string; attempt_count?: number; error?: string | null; progress?: { phase: string; message: string; updated_at: string }; artifacts?: Array<{ relative_path: string }> };
type BackgroundJobRecovery = { label: string; target: "retry" | "models" | "materials" };
type JobsScope = { workspace: string | null; alive: boolean; read: number; mutation: number; busy: boolean };
type FocusReturn = { scope: JobsScope; document: Document; from: Element | null; target: "title" | "create" | "job"; jobId?: string; ready: boolean; stop: () => void };
const labels: Record<string, string> = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", canceled: "已取消" };
const failureLabels: Record<string, string> = {
  lease_expired: "任务中断，自动恢复次数已用完",
  model_unavailable: "默认模型不可用",
  model_error: "模型处理失败",
  source_unavailable: "缺少可用材料",
  excerpt_unconfirmed: "材料正文待确认",
  stale_source: "课程或材料已变化",
  timeout: "处理超时",
  deadline_exceeded: "处理超时",
  "执行未完成，请重试": "处理未完成",
};

function InfoIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}

function workspaceFile(workspace: string, relativePath: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return `${workspace.replace(/[\\/]$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function artifactLabel(relativePath: string, index: number): string {
  return relativePath.split(/[\\/]/).filter(Boolean).at(-1) || `产物 ${index + 1}`;
}

export function backgroundJobStatusText(job: Pick<Job, "status" | "attempt_count" | "error" | "progress">) {
  const attempt = job.status === "running" && (job.attempt_count || 0) > 1 ? ` · 第${job.attempt_count}次尝试` : "";
  const progress = ["queued", "running"].includes(job.status) && job.progress?.message ? ` · ${job.progress.message}` : "";
  const error = job.status === "failed" ? ` · ${failureLabels[job.error || ""] || "处理未完成"}` : "";
  return `${labels[job.status] || job.status}${attempt}${progress}${error}`;
}

export function backgroundJobRecovery(job: Pick<Job, "status" | "error">): BackgroundJobRecovery | null {
  if (job.status === "canceled") return { label: "重新开始", target: "retry" };
  if (job.status !== "failed") return null;
  if (job.error === "model_unavailable" || job.error === "model_error") return { label: "配置模型", target: "models" };
  if (job.error === "source_unavailable" || job.error === "excerpt_unconfirmed" || job.error === "stale_source") return { label: "检查材料", target: "materials" };
  return { label: "重试", target: "retry" };
}

export function backgroundJobTechnicalDetail(error: string | null | undefined): string | null {
  const value = error?.trim();
  return value ? value.slice(0, 240) : null;
}

export function EduPiBackgroundJobs({ data, onMaterials, onModels }: { data: EducationContract | null; onMaterials: () => void; onModels: () => void }) {
  const workspace = data?.workspace ?? null;
  // A failed snapshot read does not change the draft's directory.
  const draftWorkspaceRef = useRef(workspace);
  const scopeRef = useRef<JobsScope>({ workspace, alive: true, read: 0, mutation: 0, busy: false });
  if (scopeRef.current.workspace !== workspace) {
    scopeRef.current.alive = false;
    scopeRef.current = { workspace, alive: true, read: 0, mutation: 0, busy: false };
  }
  const scope = scopeRef.current;
  const [snapshot, setSnapshot] = useState<{ scope: JobsScope; jobs: Job[] } | null>(null);
  const jobs = snapshot?.scope === scope ? snapshot.jobs : [];
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [kind, setKind] = useState("document");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusGeneration, setFocusGeneration] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const focusReturnRef = useRef<FocusReturn | null>(null);
  const clearFocusReturn = useCallback((request = focusReturnRef.current) => {
    request?.stop();
    if (focusReturnRef.current === request) focusReturnRef.current = null;
  }, []);
  const load = useCallback(async () => {
    if (!scope.alive || scopeRef.current !== scope) return;
    const read = ++scope.read;
    const response = await fetch("/api/edupi/jobs", { cache: "no-store" });
    if (!scope.alive || scopeRef.current !== scope || read !== scope.read) return;
    if (!response.ok) throw new Error("后台任务暂不可用");
    const result = await response.json();
    if (scope.alive && scopeRef.current === scope && read === scope.read) setSnapshot({ scope, jobs: result.projection.jobs });
  }, [scope]);
  useEffect(() => {
    scope.alive = true;
    setCreating(false); setBusy(false); setError("");
    if (scope.workspace) {
      if (draftWorkspaceRef.current && draftWorkspaceRef.current !== scope.workspace) { setTitle(""); setInstructions(""); setKind("document"); setSource(""); }
      draftWorkspaceRef.current = scope.workspace;
    }
    const refresh = () => {
      if (scope.alive && !document.hidden && !scope.busy) {
        const previousRead = scope.read;
        void load().catch(error => { if (scope.alive && scopeRef.current === scope && scope.read === previousRead + 1) setError(error.message); });
      }
    };
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => {
      scope.alive = false; scope.read++; scope.mutation++; scope.busy = false;
      window.clearInterval(timer);
      if (focusReturnRef.current?.scope === scope) clearFocusReturn();
    };
  }, [scope, load, clearFocusReturn]);
  useEffect(() => {
    const request = focusReturnRef.current;
    if (!request || !request.ready || busy) return;
    const root = rootRef.current;
    if (request.scope !== scope || !scope.alive || !root?.isConnected || root.ownerDocument !== request.document) { clearFocusReturn(request); return; }
    const target = request.target === "title" ? titleRef.current : request.target === "create" ? createRef.current
      : [...root.querySelectorAll<HTMLButtonElement>("[data-background-job-action]")].find(button => button.dataset.backgroundJobAction === request.jobId) || headingRef.current;
    clearFocusReturn(request);
    const active = request.document.activeElement;
    if (active !== request.from && active !== request.document.body && active !== request.document.documentElement) return;
    if (target?.isConnected && !("disabled" in target && target.disabled) && root.contains(target)
      && !target.closest("details:not([open]), [hidden], [inert]")) target.focus({ preventScroll: false });
  }, [busy, creating, snapshot, scope, focusGeneration, clearFocusReturn]);
  const rememberFocus = (target: FocusReturn["target"], ready = true, jobId?: string) => {
    clearFocusReturn();
    const document = rootRef.current?.ownerDocument;
    if (!document) return null;
    const request: FocusReturn = { scope, document, from: document.activeElement, target, jobId, ready, stop: () => {} };
    const moved = (event: FocusEvent) => {
      if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) clearFocusReturn(request);
    };
    request.stop = () => document.removeEventListener("focusin", moved);
    focusReturnRef.current = request;
    document.addEventListener("focusin", moved);
    return request;
  };
  const openCreate = () => {
    if (!scope.workspace || !scope.alive || scopeRef.current !== scope || scope.busy) return;
    rememberFocus("title"); setError(""); setCreating(true);
  };
  const cancelCreate = () => {
    if (!scope.alive || scopeRef.current !== scope || scope.busy) return;
    rememberFocus("create"); setError(""); setCreating(false);
  };
  const action = async (body: Record<string, unknown>) => {
    if (!scope.workspace || !scope.alive || scopeRef.current !== scope || scope.busy) return;
    scope.busy = true;
    const mutation = ++scope.mutation;
    scope.read++;
    const current = () => scope.alive && scopeRef.current === scope && mutation === scope.mutation;
    const enqueuing = body.action === "enqueue";
    const request = rememberFocus(enqueuing ? "create" : "job", false, typeof body.jobId === "string" ? body.jobId : undefined);
    let accepted = false;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/edupi/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(result.error || "操作失败");
      accepted = true;
      if (enqueuing) { setCreating(false); setTitle(""); setInstructions(""); setKind("document"); setSource(""); }
      await load();
    } catch (error) {
      if (current()) {
        if (enqueuing && request && !accepted) request.target = "title";
        setError(error instanceof Error ? error.message : "操作失败");
      }
    } finally {
      if (current()) { scope.busy = false; if (request) request.ready = true; setBusy(false); setFocusGeneration(value => value + 1); }
    }
  };
  const recover = (job: Job) => {
    const recovery = backgroundJobRecovery(job);
    if (!recovery) return;
    if (recovery.target === "models") onModels();
    else if (recovery.target === "materials") onMaterials();
    else void action({ action: "retry", jobId: job.job_id });
  };
  return <section ref={rootRef} aria-label="后台文档任务">
    <header style={{ display: "flex", justifyContent: "space-between", margin: "20px 0 12px" }}><h2 ref={headingRef} tabIndex={-1}>后台任务</h2>{!creating ? <button ref={createRef} type="button" className="native-button" disabled={busy || !workspace} onClick={openCreate}>新建任务</button> : null}</header>
    {creating ? <form style={{ display: "grid", gap: 10 }} onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && !scope.busy) { event.preventDefault(); event.stopPropagation(); cancelCreate(); } }} onSubmit={event => { event.preventDefault(); void action({ action: "enqueue", title, kind, instructions: `${instructions}${source ? `\n材料文件：${source}` : ""}` }); }}>
      <fieldset disabled={busy} style={{ display: "grid", gap: 10, border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <label>任务名称<input ref={titleRef} required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>类型<select value={kind} onChange={event => setKind(event.target.value)}><option value="document">整理文档</option><option value="ocr">图片识别</option><option value="ppt">制作课件</option><option value="long_task">其他任务</option></select></label>
      <label>材料<select value={source} onChange={event => setSource(event.target.value)}><option value="">不指定材料</option>{data ? buildMaterialRows(data).filter(item => item.filePath).map(item => <option key={item.id} value={item.filePath!}>{item.title}</option>) : null}</select></label>
      <label>处理要求<textarea required rows={3} maxLength={10000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
      <div style={{ display: "flex", gap: 8 }}><button className="native-button is-primary" disabled={busy} type="submit">{busy ? "提交中…" : "开始处理"}</button><button className="native-button" type="button" onClick={cancelCreate}>取消</button></div>
      </fieldset>
    </form> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="edupi-admin-list">{jobs.map(job => { const recovery = backgroundJobRecovery(job); const technicalDetail = job.status === "failed" ? backgroundJobTechnicalDetail(job.error) : null; return <div className="edupi-background-job-row" key={job.job_id}><span><strong>{job.title}</strong><small>{backgroundJobStatusText(job)}</small></span><div className="edupi-background-job-actions">{technicalDetail ? <details className="edupi-background-job-details"><summary aria-label={`查看“${job.title}”技术详情`} title="技术详情"><InfoIcon /></summary><code>{technicalDetail}</code></details> : null}{["queued", "running"].includes(job.status) ? <button type="button" data-background-job-action={job.job_id} disabled={busy || !workspace} onClick={() => void action({ action: "cancel", jobId: job.job_id })}>取消</button> : recovery ? <button type="button" data-background-job-action={job.job_id} disabled={busy || !workspace && recovery.target === "retry"} onClick={() => recover(job)}>{recovery.label}</button> : job.artifacts?.length && data && isTauriDesktop() ? <div className="edupi-background-job-artifacts">{job.artifacts.map((file, index) => <button type="button" key={file.relative_path} onClick={() => void openPathNative(workspaceFile(data.workspace, file.relative_path)).catch(() => setError("文件打开失败"))}>{artifactLabel(file.relative_path, index)}</button>)}</div> : <button type="button" onClick={onMaterials}>查看产物</button>}</div></div>; })}{jobs.length === 0 ? <div>暂无后台任务</div> : null}</div>
  </section>;
}
