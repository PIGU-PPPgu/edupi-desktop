"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EducationContract, EducationEntityDeleteKind } from "@/lib/edupi-education-contract";
import type { OnboardingChecklistItem, TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { WorkbenchView } from "@/lib/edupi-workbench";
import type { EduPiWorkspaceBundle } from "@/lib/edupi-education-client";
import { APP_VERSION_DISPLAY } from "@/lib/branding";
import { useDesktopChrome, WindowControls } from "./desktop";
import type { AppSettingsPage } from "./AppSettings";
import { SETTINGS_GROUPS, isPreferenceSection, searchSettings, type SettingsSectionId, type SettingSearchResult } from "@/lib/edupi-settings-navigation";
import { EduPiSettingsIcon } from "./EduPiSettingsIcon";
import { EduPiBackgroundJobs } from "./EduPiBackgroundJobs";
import { startWindowDragging } from "@/lib/desktop-window";
import { formatCoreSchedulerStatus } from "@/lib/edupi-schedule-display";
import { coreExecutionReadinessLabel, type CoreRuntimeHealth, type CoreRuntimeScheduler } from "@/lib/edupi-runtime-health";
import { EduPiCoreCompatibility, type CoreCompatibilitySnapshot } from "./EduPiCoreCompatibility";
import { reconnectEduPiCore, repairEduPiCore } from "@/lib/edupi-runtime-client";
import { kernelRunAction, kernelRunDetail, kernelRunTitle, type KernelRunDisplayInput } from "@/lib/edupi-kernel-display";
import { EduPiDeletedEntities } from "./EduPiDeletedEntities";
import { readEducationEntityDeletions, restoreEducationEntity } from "@/lib/edupi-entity-delete-client";
import { EduPiProactivityCanary } from "./EduPiProactivityCanary";
import { EduPiPromptOutboxRecovery } from "./EduPiPromptOutboxRecovery";
import { JevSettingsCard } from "./JevSettingsCard";
import { OpenConnectorAdminPanel } from "./OpenConnectorAdminPanel";

type AdminSnapshot = {
  context: TeacherContextSnapshot | null;
  education: EducationContract | null;
  status: {
    core?: { status?: string; reason?: string | null; lifecycle?: string; coreCommit?: string; validationMode?: string; componentManifestHash?: string; runtimeComponentManifestHash?: string; contractVersion?: string; schemaHash?: string; fixtureManifestHash?: string; supportedCommands?: string[]; supportedProjections?: string[]; capabilities?: CoreRuntimeHealth["capabilities"]; scheduler?: CoreRuntimeScheduler | null };
    projection?: { status?: string; reason?: string | null };
    kernel?: {
      status?: string;
      reason?: string | null;
      summary?: { total?: number; running?: number; failed?: number; needs_review?: number; succeeded?: number; skipped?: number };
      runs?: Array<KernelRunDisplayInput & { run_id?: string; updated_at?: string }>;
    };
    proactivity?: {
      status?: "active" | "paused" | "disabled" | "unavailable";
      attentionDelivery?: boolean;
      teacherFeedback?: boolean;
      currentAttentionDeliveries?: number;
      externalSend?: boolean;
    };
  } | null;
  compatibility?: CoreCompatibilitySnapshot | null;
  models: { modelList?: Array<{ id: string; provider: string }>; defaultModel?: { provider: string; modelId: string } | null } | null;
  platform: {
    status?: "ready" | "partial" | "unavailable";
    teachingSkills?: { mutation_enabled?: boolean; summary?: Record<string, number>; skills?: Array<{ skill_id?: string; title?: string; lifecycle_state?: string; trial_count?: number; can_reuse?: boolean }> } | null;
    connectors?: { connectors?: Array<{ connector_id?: string; label?: string; status?: string; capabilities?: string[] }> } | null;
    agentComputer?: { summary?: Record<string, number>; jobs?: Array<{ job_id?: string; title?: string; job_type?: string; status?: string }> } | null;
    platform?: { tenant_count?: number; multi_harness_ready?: boolean; tenants?: Array<{ tenant_id?: string; label?: string; core_mode?: string; device_count?: number; harness_count?: number }> } | null;
  } | null;
};

export type AdminSectionId = SettingsSectionId | "automation" | "workspace" | "teachingSkills" | "openconnector" | "platform" | "people" | "calendar" | "materials" | "tasks" | "settings";

type Props = {
  onClose: () => void;
  onOpenContext: () => void;
  onAskStudentUpdate: () => void;
  onNavigate: (view: WorkbenchView) => void;
  modelSettingsDirty: boolean;
  settingsBusy?: boolean;
  modelsPanel: (cwd?: string) => ReactNode;
  settingsPanel: (page: AppSettingsPage) => ReactNode;
  initialSection?: AdminSectionId;
  refreshToken?: number;
};

export const ADMIN_SECTIONS = SETTINGS_GROUPS.flatMap((group) => [...group.sections]);

function visibleSection(section: AdminSectionId): SettingsSectionId {
  if (section === "settings") return "general";
  if (section === "automation") return "readiness";
  if (section === "openconnector") return "connections";
  if (section === "people") return "profile";
  if (section === "calendar" || section === "materials" || section === "tasks") return "data";
  if (section === "teachingSkills" || section === "platform" || section === "workspace") return "system";
  return section;
}

const FALLBACK_CHECKLIST: OnboardingChecklistItem[] = [
  { id: "identity", label: "告诉 EduPi 你是谁", status: "next", description: "称呼、学科、年级和工作身份" },
  { id: "calendar", label: "导入本学期校历", status: "optional", description: "考试、放假、会议和学校活动" },
  { id: "timetable", label: "补充课程与周节奏", status: "optional", description: "让今日工作按真实节奏出现" },
  { id: "roster", label: "导入班级名单（可选）", status: "optional", description: "先有名字即可" },
  { id: "material", label: "放入第一份真实材料", status: "optional", description: "作业、错题或课堂记录" },
];
function systemStatusLabel(status: string | undefined): string {
  if (status === "ready") return "已就绪";
  if (status === "starting") return "启动中";
  if (status === "degraded") return "需要检查";
  if (status === "draining") return "正在停止";
  if (status === "failed") return "启动失败";
  if (status === "stopped") return "已停止";
  return "不可用";
}

function readableRuntimeReason(reason: string | null | undefined): string | null {
  return reason?.replace(/\s*[（(][a-z][a-z0-9_]*[）)]/gu, "").trim() || null;
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    return response.ok ? await response.json() as T : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    return null;
  }
}

function AdminSectionHeader({ title, meta, onRefresh }: { title: string; meta?: string; onRefresh?: () => void }) {
  return <header className="edupi-admin-section__header">
    <h1>{title}</h1>
    {meta || onRefresh ? <div>{meta ? <small>{meta}</small> : null}{onRefresh ? <button type="button" onClick={onRefresh}>刷新状态</button> : null}</div> : null}
  </header>;
}

function AdminMetric({ value, label }: { value: string | number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

export function EduPiAdminPanel({ onClose, onOpenContext, onAskStudentUpdate, onNavigate, modelSettingsDirty, settingsBusy = false, modelsPanel, settingsPanel, initialSection = "general", refreshToken = 0 }: Props) {
  const desktopChrome = useDesktopChrome();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => visibleSection(initialSection));
  const [modelsMounted, setModelsMounted] = useState(() => visibleSection(initialSection) === "models");
  const [modelPane, setModelPane] = useState<"chat" | "browser">("chat");
  const [connectionsMounted, setConnectionsMounted] = useState(() => visibleSection(initialSection) === "connections");
  const [settingsMounted, setSettingsMounted] = useState(() => isPreferenceSection(visibleSection(initialSection)));
  const [settingsPage, setSettingsPage] = useState<AppSettingsPage>(() => {
    const section = visibleSection(initialSection);
    return isPreferenceSection(section) ? section : "general";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({ context: null, education: null, status: null, compatibility: null, models: null, platform: null });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [coreReconnecting, setCoreReconnecting] = useState(false);
  const [coreReconnectMessage, setCoreReconnectMessage] = useState<string | null>(null);
  const [coreRepairing, setCoreRepairing] = useState(false);
  const activeNavRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const navigationBusyRef = useRef(settingsBusy);
  navigationBusyRef.current = settingsBusy;
  const openSection = useCallback((section: AdminSectionId) => {
    if (navigationBusyRef.current) return;
    const visible = visibleSection(section);
    if (visible === "models") setModelsMounted(true);
    if (visible === "connections") setConnectionsMounted(true);
    if (isPreferenceSection(visible)) { setSettingsMounted(true); setSettingsPage(visible); }
    setSearchQuery("");
    setSearchTarget(null);
    setActiveSection(visible);
  }, []);
  const leaveAdmin = useCallback((action: () => void) => {
    if (settingsBusy) return;
    if (modelSettingsDirty && !window.confirm("AI 模型设置尚未保存，仍要离开设置吗？")) return;
    action();
  }, [settingsBusy, modelSettingsDirty]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeNavRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  useEffect(() => {
    if (!searchTarget || searchQuery) return;
    let target: HTMLElement | null = null;
    let previousTabIndex: string | null = null;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    let disposed = false;
    const locate = () => {
      if (disposed || target) return;
      target = workspaceRef.current?.querySelector<HTMLElement>(`[data-setting-id="${searchTarget}"]`) ?? null;
      if (!target) return;
      if (target.closest("[hidden]")) { target = null; return; }
      observer.disconnect();
      clearTimeout(deadline);
      for (let details = target.closest("details"); details; details = details.parentElement?.closest("details") ?? null) details.open = true;
      if (searchTarget === "update-proxy") target.querySelector("details")?.setAttribute("open", "");
      previousTabIndex = target.getAttribute("tabindex");
      target.setAttribute("tabindex", "-1");
      target.classList.add("is-setting-target");
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    };
    // AppSettings is a dynamic chunk. Observe its arrival rather than assuming
    // the target exists in the first animation frame after page navigation.
    const observer = new MutationObserver(locate);
    observer.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    const deadline = setTimeout(() => observer.disconnect(), 10_000);
    const frame = requestAnimationFrame(locate);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(deadline);
      cancelAnimationFrame(frame);
      target?.classList.remove("is-setting-target");
      if (target) {
        if (previousTabIndex === null) target.removeAttribute("tabindex");
        else target.setAttribute("tabindex", previousTabIndex);
      }
    };
  }, [searchTarget, searchQuery, activeSection, modelPane]);

  const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery]);
  const openSearchResult = (result: SettingSearchResult) => {
    openSection(result.section);
    if (result.modelPane) setModelPane(result.modelPane);
    setSearchTarget(result.id);
  };

  useEffect(() => {
    openSection(initialSection);
  }, [initialSection, openSection]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const [bundle, status, platform] = await Promise.all([
        readJson<EduPiWorkspaceBundle>("/api/edupi/workspace", controller.signal),
        readJson<AdminSnapshot["status"] & { compatibility?: CoreCompatibilitySnapshot }>("/api/edupi/status", controller.signal),
        readJson<AdminSnapshot["platform"]>("/api/edupi/platform", controller.signal),
      ]);
      const context = bundle?.context ?? null;
      const education = bundle?.data ?? null;
      const models = await readJson<AdminSnapshot["models"]>(education?.workspace ? `/api/models?cwd=${encodeURIComponent(education.workspace)}` : "/api/models", controller.signal)
        || await readJson<AdminSnapshot["models"]>("/api/models", controller.signal);
      if (!controller.signal.aborted) setSnapshot({ context, education, status, compatibility: status?.compatibility || null, models, platform });
    })().finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, refreshToken]);

  const checklist = useMemo(() => snapshot.context?.checklist ?? FALLBACK_CHECKLIST, [snapshot.context?.checklist]);
  const coreConnected = snapshot.status?.core?.status === "ready";
  const projectionConnected = snapshot.status?.projection?.status === "ready";
  const coreReady = coreConnected && projectionConnected;
  const modelReady = Boolean(snapshot.models?.defaultModel && (snapshot.models.modelList?.length || 0) > 0);
  const allSourcesLoaded = Boolean(snapshot.context && snapshot.education && snapshot.status);
  const readiness = useMemo(() => [
    { id: "core", label: "Core 与教育投影", complete: coreReady, action: () => openSection("system") },
    { id: "model", label: "默认模型", complete: modelReady, action: () => openSection("models") },
    ...checklist.map((item) => ({
      id: item.id,
      label: item.label,
      complete: item.status === "complete",
      action: () => {
        if (item.id === "identity") openSection("profile");
        else if (item.id === "calendar" || item.id === "timetable") leaveAdmin(() => onNavigate("calendar"));
        else if (item.id === "roster") leaveAdmin(() => onNavigate("students"));
        else leaveAdmin(() => onNavigate("materials"));
      },
    })),
  ], [checklist, coreReady, modelReady, openSection, onNavigate, leaveAdmin]);
  const completeCount = readiness.filter((item) => item.complete).length;
  const education = snapshot.education;
  const kernel = snapshot.status?.kernel;
  const kernelSummary = kernel?.summary;
  const kernelRuns = kernel?.runs ?? [];
  const automationStatus = readableRuntimeReason(kernel?.reason)
    || (!coreConnected ? readableRuntimeReason(snapshot.status?.core?.reason) || systemStatusLabel(snapshot.status?.core?.status) : null)
    || (kernel?.status === "ready" ? coreExecutionReadinessLabel(snapshot.status?.core?.capabilities) : systemStatusLabel(kernel?.status));
  const refresh = () => setRefreshKey((value) => value + 1);
  const restoreDeletedEntity = useCallback(async (kind: EducationEntityDeleteKind, id: string, restoreRequestId: string): Promise<void> => {
    const result = await restoreEducationEntity(kind, id, restoreRequestId);
    setSnapshot((current) => ({ ...current, education: result.data }));
    window.dispatchEvent(new Event("edupi-education-refresh"));
  }, []);
  const reconnectCore = async () => {
    if (coreReconnecting) return;
    setCoreReconnecting(true);
    setCoreReconnectMessage(null);
    try {
      await reconnectEduPiCore();
      setCoreReconnectMessage("Core 已重新连接");
      refresh();
    } catch (error) {
      setCoreReconnectMessage(error instanceof Error ? error.message : "Core 重新连接失败");
    } finally {
      setCoreReconnecting(false);
    }
  };
  const repairCore = async () => {
    if (coreRepairing || !window.confirm("只修复 Core Runtime 状态库，教师记忆、校历和课表不会改动。继续？")) return;
    setCoreRepairing(true);
    setCoreReconnectMessage(null);
    try {
      await repairEduPiCore();
      setCoreReconnectMessage("Core Runtime 已修复并重新连接");
      refresh();
    } catch (error) {
      setCoreReconnectMessage(error instanceof Error ? error.message : "Core Runtime 修复失败");
    } finally {
      setCoreRepairing(false);
    }
  };
  return <section className={`edupi-admin-panel${desktopChrome.isDesktop ? " has-desktop-drag-region" : ""}`} aria-label="EduPi 设置">
    {desktopChrome.isDesktop ? <div className="edupi-window-drag-region" {...desktopChrome.dragRegionProps} onMouseDown={(event) => { if (event.button === 0 && event.target === event.currentTarget) void startWindowDragging(); }}><WindowControls /></div> : null}
    <aside className="edupi-admin-sidebar">
      <header><button className="edupi-admin-sidebar__back" type="button" disabled={settingsBusy} onClick={() => leaveAdmin(onClose)}><EduPiSettingsIcon name="arrow" />返回工作台</button><strong>设置</strong></header>
      <label className="edupi-settings-search"><EduPiSettingsIcon name="search" /><input ref={searchRef} type="search" aria-label="搜索设置" aria-controls={searchQuery.trim() ? "edupi-settings-search-results" : undefined} placeholder="搜索设置" autoComplete="off" maxLength={100} value={searchQuery} disabled={settingsBusy} onChange={(event) => { setSearchQuery(event.target.value); setSearchTarget(null); }} onKeyDown={(event) => {
        if (event.key === "Escape" && searchQuery) { event.preventDefault(); setSearchQuery(""); activeNavRef.current?.focus(); }
        if (event.key === "Enter" && searchResults[0]) { event.preventDefault(); openSearchResult(searchResults[0]); }
        if (event.key === "ArrowDown" && searchResults.length) { event.preventDefault(); workspaceRef.current?.querySelector<HTMLButtonElement>(".edupi-settings-search-results button")?.focus(); }
      }} /></label>
      <nav aria-label="设置分类">
        {SETTINGS_GROUPS.map((group) => <section className="edupi-settings-nav-group" key={group.label}><h2>{group.label}</h2>{group.sections.map((section) => <button
          type="button"
          key={section.id}
          ref={section.id === activeSection ? activeNavRef : undefined}
          aria-current={activeSection === section.id ? "page" : undefined}
          disabled={settingsBusy}
          onClick={() => openSection(section.id)}
        ><EduPiSettingsIcon name={section.icon} />{section.label}</button>)}</section>)}
      </nav>
      <div className="edupi-settings-nav-footer">
        <button type="button" ref={activeSection === "deleted" ? activeNavRef : undefined} aria-current={activeSection === "deleted" ? "page" : undefined} disabled={settingsBusy} onClick={() => openSection("deleted")}><EduPiSettingsIcon name="trash" />回收站</button>
        <button type="button" ref={activeSection === "system" ? activeNavRef : undefined} aria-current={activeSection === "system" ? "page" : undefined} disabled={settingsBusy} onClick={() => openSection("system")}><EduPiSettingsIcon name="tool" />诊断</button>
      </div>
    </aside>

    <main ref={workspaceRef} className="edupi-admin-workspace" aria-busy={loading || undefined}>
      {searchQuery.trim() ? <section className="edupi-admin-section edupi-settings-search-results" id="edupi-settings-search-results" aria-label="设置搜索结果"><AdminSectionHeader title="搜索设置" /><span role="status" className="edupi-settings-search-count">{searchResults.length ? `${searchResults.length} 项设置` : "没有匹配的设置"}</span><ul>{searchResults.map((result) => <li key={result.id}><button type="button" onClick={() => openSearchResult(result)}><span><strong>{result.label}</strong><small>{result.path}</small></span><span aria-hidden="true">›</span></button></li>)}</ul></section> : null}
      <div className="edupi-settings-content" hidden={Boolean(searchQuery.trim())}>
      {activeSection === "readiness" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="自动运行" onRefresh={refresh} />
        <details className="edupi-admin-readiness">
          <summary><span>准备状态</span><strong>{loading ? "正在读取" : !allSourcesLoaded ? "暂不可用" : `${completeCount}/${readiness.length} 项完成`}</strong></summary>
          {allSourcesLoaded ? <div className="edupi-admin-readiness__bar" aria-hidden="true"><span style={{ width: `${readiness.length ? (completeCount / readiness.length) * 100 : 0}%` }} /></div> : null}
          <div className="edupi-admin-readiness__items">{readiness.map((item) => <button type="button" key={item.id} onClick={item.action}><i className={item.complete ? "is-complete" : ""} aria-hidden="true">{item.complete ? "✓" : "·"}</i><span>{item.label}</span><em>{item.complete ? "完成" : "去设置"}</em></button>)}</div>
        </details>
        <div className="edupi-admin-section-break" data-setting-id="automation-status"><h2>运行状态</h2><span>{snapshot.status?.core?.status === "ready" ? formatCoreSchedulerStatus(snapshot.status.core.scheduler, kernelRuns.length) : "运行状态不可用"}</span></div>
        <div className="edupi-admin-metrics"><AdminMetric value={kernelSummary?.running ?? "—"} label="运行中" /><AdminMetric value={kernelSummary?.needs_review ?? "—"} label="待确认" /><AdminMetric value={kernelSummary?.succeeded ?? "—"} label="已完成" /></div>
        <div className="edupi-admin-metrics"><AdminMetric value={snapshot.status?.proactivity?.status === "active" ? "主动" : snapshot.status?.proactivity?.status === "paused" ? "已暂停" : snapshot.status?.proactivity?.status === "disabled" ? "按需" : "不可用"} label="主动运行" /><AdminMetric value={snapshot.status?.proactivity?.currentAttentionDeliveries ?? "—"} label="待交付" /><AdminMetric value={snapshot.status?.proactivity?.teacherFeedback ? "可记录" : "未启用"} label="教师反馈" /></div>
        <div className="edupi-settings-automation-domains" data-setting-id="automation-domains"><h2>主动运行范围</h2>{([
          ["teaching_preparation", "课前准备"], ["student_followup", "学生跟进"], ["calendar_administration", "校历与行政"], ["lesson_reflection", "课后复盘"], ["parent_communication", "家长沟通"],
        ] as const).map(([domain, label]) => <details key={domain}><summary><span>{label}</span><small>试用配置</small></summary><EduPiProactivityCanary domain={domain} feedbackEnabled={snapshot.status?.proactivity?.teacherFeedback === true} onChanged={refresh} /></details>)}</div>
        <EduPiPromptOutboxRecovery />
        <div className="edupi-admin-section-break" data-setting-id="automation-history"><h2>最近运行</h2></div>
        <div className="edupi-admin-runtime" role="list" aria-label="最近自动运行">
          {kernelRuns.length > 0 ? kernelRuns.slice(0, 12).map((run) => {
            const action = kernelRunAction(run);
            return <div role="listitem" key={run.run_id}>
              <i className={`is-${run.status || "unknown"}`} aria-hidden="true" />
              <span><strong>{kernelRunTitle(run, education?.tasks || [])}</strong><small>{kernelRunDetail(run)}</small></span>
              {action ? <button type="button" onClick={() => { const target = action.target; if (target === "models") openSection("models"); else leaveAdmin(() => onNavigate(target)); }}>{action.label}</button> : <em>{run.status === "running" || run.status === "awaiting_delivery" ? "运行中" : run.status === "needs_review" ? "待确认" : run.status === "failed" ? "失败" : run.status === "succeeded" ? "完成" : "无内容"}</em>}
              {run.updated_at ? <time dateTime={run.updated_at}>{new Date(run.updated_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time> : null}
            </div>;
          }) : <div className="is-empty" role="status">还没有运行记录</div>}
        </div>
        <details className="edupi-settings-diagnostics"><summary>文档任务</summary><EduPiBackgroundJobs data={snapshot.education} onMaterials={() => leaveAdmin(() => onNavigate("materials"))} onModels={() => openSection("models")} /></details>
      </section> : null}

      {connectionsMounted ? <section className="edupi-admin-section is-connections" hidden={activeSection !== "connections"} data-setting-id="applications">
        <AdminSectionHeader title="应用连接" />
        <OpenConnectorAdminPanel managedConnections={snapshot.platform?.connectors?.connectors ?? []} onManagedConfigured={refresh} />
      </section> : null}

      {modelsMounted ? <section className="edupi-admin-section is-models" hidden={activeSection !== "models"}>
        <AdminSectionHeader title="AI 与模型" meta={modelPane === "chat" && snapshot.models === null ? "模型数据不可用" : undefined} />
        <div className="edupi-admin-tabs" role="group" aria-label="模型类别">
          <button id="edupi-models-chat-tab" type="button" aria-pressed={modelPane === "chat"} aria-controls="edupi-models-chat" onClick={() => setModelPane("chat")}>对话模型</button>
          <button id="edupi-models-browser-tab" type="button" aria-pressed={modelPane === "browser"} aria-controls="edupi-models-browser" onClick={() => setModelPane("browser")}>浏览器决策</button>
        </div>
        <div id="edupi-models-chat" data-setting-id="chat-models" className="edupi-admin-embedded-models" aria-labelledby="edupi-models-chat-tab" hidden={modelPane !== "chat"}>{modelsPanel(education?.workspace)}</div>
        <div id="edupi-models-browser" data-setting-id="browser-decision" aria-labelledby="edupi-models-browser-tab" hidden={modelPane !== "browser"}><JevSettingsCard /></div>
      </section> : null}

      {settingsMounted ? <section className="edupi-admin-section is-settings" hidden={!isPreferenceSection(activeSection)}>{settingsPanel(settingsPage)}{settingsPage === "data" ? <button className="edupi-settings-data-link" type="button" onClick={() => openSection("deleted")}><EduPiSettingsIcon name="trash" /><span>回收站</span><span aria-hidden="true">›</span></button> : null}</section> : null}

      {activeSection === "deleted" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="回收站" onRefresh={refresh} /><div data-setting-id="deleted-entities" />
        <EduPiDeletedEntities activeCount={education?.entityDeletionCount ?? 0} historyCount={education?.entityDeletionHistoryCount ?? 0} countUnavailable={education?.entityDeletionLedgerUnavailable ?? true} onLoad={readEducationEntityDeletions} onRestore={restoreDeletedEntity} />
      </section> : null}

      {activeSection === "system" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="诊断" onRefresh={refresh} /><div data-setting-id="runtime-status" />
        <div className="edupi-admin-list">
          <div><span><strong>EduPi Desktop</strong><small>当前安装版本</small></span><em>v{APP_VERSION_DISPLAY}</em></div>
          <button type="button" disabled={coreReconnecting || coreRepairing} onClick={coreConnected ? refresh : () => void reconnectCore()} aria-label={coreConnected ? "检查 Core 状态" : "重新连接 Core"}><span><strong>EduPi Core</strong><small aria-live="polite">{readableRuntimeReason(coreReconnectMessage) || readableRuntimeReason(snapshot.status?.core?.reason) || systemStatusLabel(snapshot.status?.core?.lifecycle || snapshot.status?.core?.status)}</small></span><em className={coreConnected ? "is-ready" : ""}>{coreReconnecting ? "连接中" : coreRepairing ? "修复中" : loading ? "检查中" : coreConnected ? "已连接" : "重新连接"}</em></button>
          {desktopChrome.isDesktop && ["runtime_root_invalid", "runtime_state_invalid", "runtime_writer_unavailable"].some((code) => snapshot.status?.core?.reason?.includes(code)) ? <button type="button" disabled={coreRepairing || coreReconnecting} onClick={() => void repairCore()}><span><strong>修复 Core Runtime</strong><small>只清理运行状态绑定，保留教师数据</small></span><em>{coreRepairing ? "处理中" : "修复"}</em></button> : null}
          <div><span><strong>教育投影</strong><small>{readableRuntimeReason(snapshot.status?.projection?.reason) || systemStatusLabel(snapshot.status?.projection?.status)}</small></span><em className={projectionConnected ? "is-ready" : ""}>{projectionConnected ? "已连接" : "检查"}</em></div>
          <div><span><strong>自动运行内核</strong><small>{automationStatus}</small></span><em>{kernelSummary?.running ? `${kernelSummary.running} 项运行中` : "空闲"}</em></div>
        </div>
        <details className="edupi-settings-diagnostics"><summary>技术信息</summary><EduPiCoreCompatibility value={snapshot.compatibility} onNavigate={(view) => leaveAdmin(() => onNavigate(view))} onOpenContext={() => leaveAdmin(onOpenContext)} /></details>
        <details className="edupi-settings-diagnostics"><summary>教育数据</summary>
        <div className="edupi-admin-work-grid">
          <article>
            <h2>任务与产物</h2>
            <strong>{education?.tasks.length ?? "—"}</strong><span>教师任务 · {education?.tasks.filter((task) => task.requiresTeacherReview).length ?? "—"} 项待确认</span>
            <button className="edupi-admin-primary" type="button" onClick={() => leaveAdmin(() => onNavigate("workspace"))}>打开任务工作区</button>
          </article>
          <article>
            <h2>上传内容</h2>
            <strong>{education?.intakeTargets.length ?? "—"}</strong><span>已接入内容</span>
            <button type="button" onClick={() => leaveAdmin(() => onNavigate("materials"))}>打开材料</button>
          </article>
          <article>
            <h2>教学能力</h2>
            <strong>{snapshot.platform ? snapshot.platform.teachingSkills?.summary?.published ?? 0 : "—"}</strong><span>已发布 · {snapshot.platform?.teachingSkills?.summary?.trial ?? "—"} 试用 · {snapshot.platform?.teachingSkills?.summary?.validated ?? "—"} 已验证</span>
            <small>{snapshot.platform?.teachingSkills?.mutation_enabled ? "可编辑" : "只读"}</small>
            {snapshot.platform?.teachingSkills?.skills?.length ? <details className="edupi-admin-work-details"><summary>查看教学能力 {snapshot.platform.teachingSkills.skills.length}</summary><ul>{snapshot.platform.teachingSkills.skills.slice(0, 20).map((skill) => <li key={skill.skill_id}><strong>{skill.title || "教学方法"}</strong><span>{({ draft: "草稿", trial: "试用中", validated: "已验证", published: "已发布", retired: "已停用" } as Record<string, string>)[skill.lifecycle_state || "draft"] || "未知状态"} · {skill.trial_count || 0} 次试用{skill.can_reuse ? " · 可复用" : ""}</span></li>)}</ul>{snapshot.platform.teachingSkills.skills.length > 20 ? <small>仅显示前 20 项</small> : null}</details> : <small>暂无候选</small>}
          </article>
          <article>
            <h2>教师与学生</h2>
            <strong>{education?.students.length ?? "—"}</strong><span>学生档案</span>
            <div className="edupi-admin-work-actions"><button type="button" onClick={() => leaveAdmin(() => onNavigate("students"))}>打开班级</button><button type="button" onClick={() => leaveAdmin(onOpenContext)}>教师信息</button></div>
          </article>
          <article>
            <h2>校历与课表</h2>
            <strong>{education?.calendar.length ?? "—"}</strong><span>校历节点 · {education?.timetable.length ?? "—"} 条课表</span>
            <button type="button" onClick={() => leaveAdmin(() => onNavigate("calendar"))}>打开日程</button>
          </article>
          <article>
            <h2>学校平台</h2>
            <strong>{snapshot.platform ? snapshot.platform.platform?.tenant_count ?? 0 : "—"}</strong><span>学校租户 · {snapshot.platform?.platform?.tenants?.reduce((sum, item) => sum + (item.device_count || 0), 0) ?? "—"} 台设备 · {snapshot.platform?.platform?.tenants?.reduce((sum, item) => sum + (item.harness_count || 0), 0) ?? "—"} 个 Harness</span>
            {snapshot.platform?.platform?.tenants?.length ? <details className="edupi-admin-work-details"><summary>查看学校空间 {snapshot.platform.platform.tenants.length}</summary><ul>{snapshot.platform.platform.tenants.map((tenant) => <li key={tenant.tenant_id}><strong>{tenant.label || tenant.tenant_id}</strong><span>{tenant.core_mode === "hosted" ? "托管 Core" : "本地 Core"} · {tenant.device_count || 0} 台设备 · {tenant.harness_count || 0} 个 Harness</span></li>)}</ul></details> : <small>尚未接入</small>}
          </article>
        </div>
        <button className="edupi-admin-work-student-ai" type="button" onClick={() => leaveAdmin(onAskStudentUpdate)}>让 EduPi 更新学生档案</button>
        </details>
      </section> : null}
      </div>
    </main>
  </section>;
}
