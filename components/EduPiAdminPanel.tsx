"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import type { OnboardingChecklistItem, TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { WorkbenchView } from "@/lib/edupi-workbench";
import type { EduPiWorkspaceBundle } from "@/lib/edupi-education-client";

type AdminSnapshot = {
  context: TeacherContextSnapshot | null;
  education: EducationContract | null;
  status: {
    core?: { status?: string };
    projection?: { status?: string };
    kernel?: {
      status?: string;
      summary?: { total?: number; running?: number; failed?: number; needs_review?: number; succeeded?: number; skipped?: number };
      runs?: Array<{ run_id?: string; trigger_id?: string; status?: string; updated_at?: string; result_summary?: string | null; attempt_count?: number }>;
    };
  } | null;
  models: { modelList?: Array<{ id: string; provider: string }>; defaultModel?: { provider: string; modelId: string } | null } | null;
};

export type AdminSectionId = "readiness" | "automation" | "models" | "people" | "calendar" | "materials" | "tasks" | "system";

type Props = {
  onClose: () => void;
  onOpenContext: () => void;
  onAskStudentUpdate: () => void;
  onNavigate: (view: WorkbenchView) => void;
  onOpenSettings: () => void;
  modelSettingsDirty: boolean;
  modelsPanel: ReactNode;
  initialSection?: AdminSectionId;
  refreshToken?: number;
};

export const ADMIN_SECTIONS: Array<{ id: AdminSectionId; label: string }> = [
  { id: "readiness", label: "EduPi 就绪度" },
  { id: "automation", label: "自动运行" },
  { id: "models", label: "AI 与模型" },
  { id: "people", label: "教师与学生" },
  { id: "calendar", label: "校历与课表" },
  { id: "materials", label: "上传内容" },
  { id: "tasks", label: "任务与产物" },
  { id: "system", label: "系统" },
];

const FALLBACK_CHECKLIST: OnboardingChecklistItem[] = [
  { id: "identity", label: "告诉 EduPi 你是谁", status: "next", description: "称呼、学科、年级和工作身份" },
  { id: "calendar", label: "导入本学期校历", status: "optional", description: "考试、放假、会议和学校活动" },
  { id: "timetable", label: "补充课程与周节奏", status: "optional", description: "让今日工作按真实节奏出现" },
  { id: "roster", label: "导入班级名单（可选）", status: "optional", description: "先有名字即可" },
  { id: "material", label: "放入第一份真实材料", status: "optional", description: "作业、错题或课堂记录" },
];

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
    <div><span>管理中心</span><h1>{title}</h1>{meta ? <small>{meta}</small> : null}</div>
    {onRefresh ? <button type="button" onClick={onRefresh}>刷新</button> : null}
  </header>;
}

function AdminMetric({ value, label }: { value: string | number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

export function EduPiAdminPanel({ onClose, onOpenContext, onAskStudentUpdate, onNavigate, onOpenSettings, modelSettingsDirty, modelsPanel, initialSection = "readiness", refreshToken = 0 }: Props) {
  const [activeSection, setActiveSection] = useState<AdminSectionId>(initialSection);
  const [modelsMounted, setModelsMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({ context: null, education: null, status: null, models: null });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const firstNavRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstNavRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (activeSection === "models") setModelsMounted(true);
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const [bundle, status] = await Promise.all([
        readJson<EduPiWorkspaceBundle>("/api/edupi/workspace", controller.signal),
        readJson<AdminSnapshot["status"]>("/api/edupi/status", controller.signal),
      ]);
      const context = bundle?.context ?? null;
      const education = bundle?.data ?? null;
      const models = await readJson<AdminSnapshot["models"]>(education?.workspace ? `/api/models?cwd=${encodeURIComponent(education.workspace)}` : "/api/models", controller.signal);
      if (!controller.signal.aborted) setSnapshot({ context, education, status, models });
    })().finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, refreshToken]);

  const checklist = useMemo(() => snapshot.context?.checklist ?? FALLBACK_CHECKLIST, [snapshot.context?.checklist]);
  const coreConnected = snapshot.status?.core?.status === "ready";
  const projectionConnected = snapshot.status?.projection?.status === "ready";
  const coreReady = coreConnected && projectionConnected;
  const modelReady = Boolean(snapshot.models?.defaultModel && (snapshot.models.modelList?.length || 0) > 0);
  const allSourcesLoaded = Boolean(snapshot.context && snapshot.education && snapshot.status && snapshot.models);
  const readiness = useMemo(() => [
    { id: "core", label: "Core 与教育投影", complete: coreReady, action: () => setActiveSection("system") },
    { id: "model", label: "默认模型", complete: modelReady, action: () => setActiveSection("models") },
    ...checklist.map((item) => ({
      id: item.id,
      label: item.label,
      complete: item.status === "complete",
      action: () => setActiveSection(item.id === "identity" || item.id === "roster" ? "people" : item.id === "calendar" || item.id === "timetable" ? "calendar" : "materials"),
    })),
  ], [checklist, coreReady, modelReady]);
  const completeCount = readiness.filter((item) => item.complete).length;
  const education = snapshot.education;
  const kernel = snapshot.status?.kernel;
  const kernelSummary = kernel?.summary;
  const kernelRuns = kernel?.runs ?? [];
  const defaultModel = snapshot.models?.defaultModel;
  const refresh = () => setRefreshKey((value) => value + 1);
  const leaveAdmin = (action: () => void) => {
    if (modelSettingsDirty && !window.confirm("AI 模型设置尚未保存，仍要离开后台吗？")) return;
    action();
  };

  return <section className="edupi-admin-panel" aria-label="EduPi 管理中心">
    <aside className="edupi-admin-sidebar">
      <header><span className="edupi-admin-sidebar__mark" aria-hidden="true">π</span><div><strong>EduPi</strong><small>后台管理</small></div></header>
      <nav aria-label="后台管理">
        {ADMIN_SECTIONS.map((section) => <button
          type="button"
          key={section.id}
          ref={section.id === "readiness" ? firstNavRef : undefined}
          aria-current={activeSection === section.id ? "page" : undefined}
          onClick={() => setActiveSection(section.id)}
        ><span aria-hidden="true" />{section.label}</button>)}
      </nav>
      <button className="edupi-admin-sidebar__back" type="button" onClick={() => leaveAdmin(onClose)}><span aria-hidden="true">←</span>返回工作台</button>
    </aside>

    <main ref={workspaceRef} className="edupi-admin-workspace" aria-busy={loading || undefined}>
      {activeSection === "readiness" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="EduPi 就绪度" meta={`${completeCount}/${readiness.length} 项完成`} onRefresh={refresh} />
        <section className="edupi-admin-readiness" aria-labelledby="edupi-admin-readiness-title">
          <header><div><span>上线就绪</span><h2 id="edupi-admin-readiness-title">{loading ? "正在读取" : !allSourcesLoaded ? "数据读取失败" : completeCount === readiness.length ? "已经准备好" : "还需要补充"}</h2></div><strong>{Math.round((completeCount / Math.max(1, readiness.length)) * 100)}%</strong></header>
          <div className="edupi-admin-readiness__bar" aria-hidden="true"><span style={{ width: `${readiness.length ? (completeCount / readiness.length) * 100 : 0}%` }} /></div>
          <div className="edupi-admin-readiness__items">{readiness.map((item) => <button type="button" key={item.id} onClick={item.action}><i className={item.complete ? "is-complete" : ""} aria-hidden="true">{item.complete ? "✓" : "·"}</i><span>{item.label}</span><em>{item.complete ? "完成" : "去设置"}</em></button>)}</div>
        </section>
      </section> : null}

      {activeSection === "automation" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="自动运行" meta={kernel?.status === "ready" ? `最近 ${kernelRuns.length} 次` : "运行状态不可用"} onRefresh={refresh} />
        <div className="edupi-admin-metrics"><AdminMetric value={kernelSummary?.running ?? "—"} label="运行中" /><AdminMetric value={kernelSummary?.needs_review ?? "—"} label="待确认" /><AdminMetric value={kernelSummary?.succeeded ?? "—"} label="已完成" /></div>
        <div className="edupi-admin-runtime" role="list" aria-label="最近自动运行">
          {kernelRuns.length > 0 ? kernelRuns.slice(0, 12).map((run) => <div role="listitem" key={run.run_id}>
            <i className={`is-${run.status || "unknown"}`} aria-hidden="true" />
            <span><strong>{run.trigger_id || "EduPi 任务"}</strong><small>{run.result_summary || `第 ${run.attempt_count || 1} 次执行`}</small></span>
            <em>{run.status === "running" || run.status === "awaiting_delivery" ? "运行中" : run.status === "needs_review" ? "待确认" : run.status === "failed" ? "失败" : run.status === "succeeded" ? "完成" : "无内容"}</em>
            {run.updated_at ? <time dateTime={run.updated_at}>{new Date(run.updated_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time> : null}
          </div>) : <div className="is-empty" role="status">还没有运行记录</div>}
        </div>
      </section> : null}

      {modelsMounted ? <section className="edupi-admin-section is-models" hidden={activeSection !== "models"}>
        <AdminSectionHeader title="AI 与模型" meta={snapshot.models === null ? "模型数据不可用" : defaultModel ? `${defaultModel.provider} / ${defaultModel.modelId}` : "默认模型待配置"} />
        <div className="edupi-admin-embedded-models">{modelsPanel}</div>
      </section> : null}

      {activeSection === "people" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="教师与学生" meta={snapshot.context?.name || "教师身份与班级档案"} onRefresh={refresh} />
        <div className="edupi-admin-metrics"><AdminMetric value={snapshot.context?.configured ? "已配置" : "待配置"} label="教师身份" /><AdminMetric value={education?.students.length ?? "—"} label="学生档案" /></div>
        <div className="edupi-admin-list">
          <button type="button" onClick={() => leaveAdmin(onOpenContext)}><span><strong>教师与学校</strong><small>称呼、角色、学科、年级</small></span><em>打开</em></button>
          <button type="button" onClick={() => leaveAdmin(() => onNavigate("students"))}><span><strong>学生档案</strong><small>{education ? `${education.students.length} 位学生` : "数据不可用"}</small></span><em>进入工作台</em></button>
          <button type="button" onClick={() => leaveAdmin(onAskStudentUpdate)}><span><strong>让 EduPi 更新档案</strong><small>从名单、作业或课堂记录整理候选</small></span><em>AI 协作</em></button>
        </div>
      </section> : null}

      {activeSection === "calendar" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="校历与课表" meta="学期节奏" onRefresh={refresh} />
        <div className="edupi-admin-metrics"><AdminMetric value={education?.calendar.length ?? "—"} label="校历节点" /><AdminMetric value={education?.timetable.length ?? "—"} label="课程安排" /></div>
        <button className="edupi-admin-primary" type="button" onClick={() => leaveAdmin(() => onNavigate("calendar"))}>进入日程管理</button>
      </section> : null}

      {activeSection === "materials" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="上传内容" meta="材料接入" onRefresh={refresh} />
        <div className="edupi-admin-metrics"><AdminMetric value={education?.intakeTargets.length ?? "—"} label="已接入内容" /></div>
        <button className="edupi-admin-primary" type="button" onClick={() => leaveAdmin(() => onNavigate("materials"))}>进入材料管理</button>
      </section> : null}

      {activeSection === "tasks" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="任务与产物" meta="EduPi 工作流" onRefresh={refresh} />
        <div className="edupi-admin-metrics"><AdminMetric value={education?.tasks.length ?? "—"} label="教师任务" /><AdminMetric value={education?.tasks.filter((task) => task.requiresTeacherReview).length ?? "—"} label="需要确认" /></div>
        <button className="edupi-admin-primary" type="button" onClick={() => leaveAdmin(() => onNavigate("workspace"))}>进入任务工作区</button>
      </section> : null}

      {activeSection === "system" ? <section className="edupi-admin-section">
        <AdminSectionHeader title="系统" meta={education?.workspace || "数据目录待连接"} onRefresh={refresh} />
        <div className="edupi-admin-list">
          <div><span><strong>EduPi Core</strong><small>{snapshot.status?.core?.status || "不可用"}</small></span><em className={coreConnected ? "is-ready" : ""}>{coreConnected ? "已连接" : "检查"}</em></div>
          <div><span><strong>教育投影</strong><small>{snapshot.status?.projection?.status || "不可用"}</small></span><em className={projectionConnected ? "is-ready" : ""}>{projectionConnected ? "已连接" : "检查"}</em></div>
          <button type="button" onClick={() => setActiveSection("automation")}><span><strong>自动运行内核</strong><small>{kernel?.status || "不可用"}</small></span><em>{kernelSummary?.running ? `${kernelSummary.running} 项运行中` : "查看"}</em></button>
          <button type="button" onClick={onOpenSettings}><span><strong>应用与桌面设置</strong><small>外观、桌面行为与更新</small></span><em>打开</em></button>
        </div>
      </section> : null}
    </main>
  </section>;
}
