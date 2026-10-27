"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { buildMaterialRows } from "@/lib/edupi-material-rows";
import { openPathNative } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";

type Job = { job_id: string; title: string; status: string; attempt_count?: number; error?: string | null; progress?: { phase: string; message: string; updated_at: string }; artifacts?: Array<{ relative_path: string }> };
type BackgroundJobRecovery = { label: string; target: "retry" | "models" | "materials" };
type JobsScope = { workspace: string | null; alive: boolean; read: number; mutation: number; busy: boolean };
type FocusReturn = { scope: JobsScope; document: Document; from: Element | null; target: "title" | "create" | "job"; jobId?: string; reveal?: boolean; replacedControl?: HTMLButtonElement; read?: number; ready: boolean; stop: () => void };
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
  const rememberFocus = useCallback((target: FocusReturn["target"], ready = true, jobId?: string) => {
    clearFocusReturn();
    const document = rootRef.current?.ownerDocument;
    if (!document || document.hidden) return null;
    const request: FocusReturn = { scope, document, from: document.activeElement, target, jobId, ready, stop: () => {} };
    const moved = (event: FocusEvent) => {
      if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) clearFocusReturn(request);
    };
    const visibilityChanged = () => { if (document.hidden) clearFocusReturn(request); };
    request.stop = () => { document.removeEventListener("focusin", moved); document.removeEventListener("visibilitychange", visibilityChanged); };
    focusReturnRef.current = request;
    document.addEventListener("focusin", moved);
    document.addEventListener("visibilitychange", visibilityChanged);
    return request;
  }, [scope, clearFocusReturn]);
  const load = useCallback(async () => {
    if (!scope.alive || scopeRef.current !== scope) return;
    const read = ++scope.read;
    const current = () => scope.alive && scopeRef.current === scope && read === scope.read;
    if (focusReturnRef.current?.read !== undefined) clearFocusReturn();
    const root = rootRef.current;
    const control = !scope.busy && !focusReturnRef.current && root?.isConnected
      ? [...root.querySelectorAll<HTMLButtonElement>("[data-background-job-action]")].find(button => button === root.ownerDocument.activeElement && !button.disabled) : null;
    const request = control ? rememberFocus("job", false, control.dataset.backgroundJobAction) : null;
    if (request) { request.replacedControl = control!; request.read = read; }
    try {
      const response = await fetch("/api/edupi/jobs", { cache: "no-store" });
      if (!current()) return;
      if (!response.ok) throw new Error("后台任务暂不可用");
      const result = await response.json();
      if (current()) { if (request) request.ready = true; setSnapshot({ scope, jobs: result.projection.jobs }); }
    } finally {
      if (request && (!current() || !request.ready)) clearFocusReturn(request);
    }
  }, [scope, rememberFocus, clearFocusReturn]);
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
    if (!request) return;
    if (request.document.hidden) { clearFocusReturn(request); return; }
    if (!request.ready || busy) return;
    const root = rootRef.current;
    if (request.scope !== scope || !scope.alive || !root?.isConnected || root.ownerDocument !== request.document) { clearFocusReturn(request); return; }
    if (request.read !== undefined && (request.read !== scope.read || request.replacedControl?.isConnected)) { clearFocusReturn(request); return; }
    let target: HTMLElement | null;
    if (request.target === "title") target = titleRef.current;
    else if (request.target === "create") target = createRef.current;
    else target = (!request.replacedControl && [...root.querySelectorAll<HTMLButtonElement>("[data-background-job-action]")].find(button => button.dataset.backgroundJobAction === request.jobId))
      || [...root.querySelectorAll<HTMLButtonElement>("[data-background-job-artifact]")].find(button => button.dataset.backgroundJobArtifact === request.jobId)
      || [...root.querySelectorAll<HTMLElement>("[data-background-job-title]")].find(title => title.dataset.backgroundJobTitle === request.jobId)
      || (request.replacedControl ? null : headingRef.current);
    clearFocusReturn(request);
    const active = request.document.activeElement;
    if (active !== request.from && active !== request.document.body && active !== request.document.documentElement) return;
    if (target?.isConnected && !("disabled" in target && target.disabled) && root.contains(target)
      && !target.closest("details:not([open]), [hidden], [inert]")) {
      const heading = request.reveal ? headingRef.current : null;
      const reveal = Boolean(heading?.isConnected && root.contains(heading));
      if (reveal) heading!.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
      target.focus({ preventScroll: reveal || Boolean(request.replacedControl) });
    }
  }, [busy, creating, snapshot, scope, focusGeneration, clearFocusReturn]);
  const openCreate = () => {
    if (!scope.workspace || !scope.alive || scopeRef.current !== scope || scope.busy) return;
    const request = rememberFocus("title");
    if (request) request.reveal = true;
    setError(""); setCreating(true);
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
  return <section ref={rootRef} className="edupi-background-jobs" aria-label="后台文档任务">
    <header className="edupi-background-job-header"><h2 ref={headingRef} tabIndex={-1}>{creating ? "新建任务" : "后台任务"}</h2>{!creating ? <button ref={createRef} type="button" className="native-button" disabled={busy || !workspace} onClick={openCreate}>新建任务</button> : null}</header>
    {creating ? <form className="edupi-background-job-form" onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && !scope.busy) { event.preventDefault(); event.stopPropagation(); cancelCreate(); } }} onSubmit={event => { event.preventDefault(); void action({ action: "enqueue", title, kind, instructions: `${instructions}${source ? `\n材料文件：${source}` : ""}` }); }}>
      <fieldset disabled={busy} className="edupi-background-job-fields">
        <label className="native-field edupi-background-job-field-wide"><span className="native-field-label">任务名称</span><input className="native-input" ref={titleRef} required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="native-field"><span className="native-field-label">类型</span><select className="native-select" value={kind} onChange={event => setKind(event.target.value)}><option value="document">整理文档</option><option value="ocr">图片识别</option><option value="ppt">制作课件</option><option value="long_task">其他任务</option></select></label>
        <label className="native-field"><span className="native-field-label">材料</span><select className="native-select" value={source} onChange={event => setSource(event.target.value)}><option value="">不指定材料</option>{data ? buildMaterialRows(data).filter(item => item.filePath).map(item => <option key={item.id} value={item.filePath!}>{item.title}</option>) : null}</select></label>
        <label className="native-field edupi-background-job-field-wide"><span className="native-field-label">处理要求</span><textarea className="native-input" required rows={4} maxLength={10000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
        <div className="edupi-background-job-form-actions"><button className="native-button native-button-primary" disabled={busy} type="submit">{busy ? "提交中…" : "开始处理"}</button><button className="native-button" type="button" onClick={cancelCreate}>取消</button></div>
      </fieldset>
    </form> : null}
    {error ? <p role="alert">{error}</p> : null}
    {jobs.length > 0 || !creating ? <div className="edupi-admin-list">{jobs.map(job => { const recovery = backgroundJobRecovery(job); const technicalDetail = job.status === "failed" ? backgroundJobTechnicalDetail(job.error) : null; return <div className="edupi-background-job-row" key={job.job_id}><span><strong data-background-job-title={job.job_id} tabIndex={-1}>{job.title}</strong><small>{backgroundJobStatusText(job)}</small></span><div className="edupi-background-job-actions">{technicalDetail ? <details className="edupi-background-job-details"><summary aria-label={`查看“${job.title}”技术详情`} title="技术详情"><InfoIcon /></summary><code>{technicalDetail}</code></details> : null}{["queued", "running"].includes(job.status) ? <button type="button" data-background-job-action={job.job_id} disabled={busy || !workspace} onClick={() => void action({ action: "cancel", jobId: job.job_id })}>取消</button> : recovery ? <button type="button" data-background-job-action={job.job_id} disabled={busy || !workspace && recovery.target === "retry"} onClick={() => recover(job)}>{recovery.label}</button> : job.artifacts?.length && data && isTauriDesktop() ? <div className="edupi-background-job-artifacts">{job.artifacts.map((file, index) => <button type="button" data-background-job-artifact={job.job_id} key={file.relative_path} onClick={() => void openPathNative(workspaceFile(data.workspace, file.relative_path)).catch(() => setError("文件打开失败"))}>{artifactLabel(file.relative_path, index)}</button>)}</div> : <button type="button" onClick={onMaterials}>查看产物</button>}</div></div>; })}{jobs.length === 0 ? <div>暂无后台任务</div> : null}</div> : null}
  </section>;
}
