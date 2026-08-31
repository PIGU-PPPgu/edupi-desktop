"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import type { OnboardingChecklistItem, TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { WorkbenchView } from "@/lib/edupi-workbench";

type AdminSnapshot = {
  context: TeacherContextSnapshot | null;
  education: EducationContract | null;
  status: { core?: { status?: string }; projection?: { status?: string } } | null;
  models: { modelList?: Array<{ id: string; provider: string }>; defaultModel?: { provider: string; modelId: string } | null } | null;
};

type Props = {
  onClose: () => void;
  onOpenModels: () => void;
  onOpenContext: () => void;
  onAskStudentUpdate: () => void;
  onNavigate: (view: WorkbenchView) => void;
  onOpenSettings: () => void;
  refreshToken?: number;
};

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

export function EduPiAdminPanel({ onClose, onOpenModels, onOpenContext, onAskStudentUpdate, onNavigate, onOpenSettings, refreshToken = 0 }: Props) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot>({ context: null, education: null, status: null, models: null });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const [context, education, status] = await Promise.all([
      readJson<TeacherContextSnapshot>("/api/edupi/onboarding", controller.signal),
      readJson<EducationContract>("/api/edupi/education", controller.signal),
      readJson<AdminSnapshot["status"]>("/api/edupi/status", controller.signal),
      ]);
      const models = await readJson<AdminSnapshot["models"]>(education?.workspace ? `/api/models?cwd=${encodeURIComponent(education.workspace)}` : "/api/models", controller.signal);
      if (!controller.signal.aborted) setSnapshot({ context, education, status, models });
    })().finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, refreshToken]);

  const checklist = useMemo(() => snapshot.context?.checklist ?? FALLBACK_CHECKLIST, [snapshot.context?.checklist]);
  const coreReady = snapshot.status?.core?.status === "ready" && snapshot.status?.projection?.status === "ready";
  const modelReady = Boolean(snapshot.models?.defaultModel && (snapshot.models.modelList?.length || 0) > 0);
  const allSourcesLoaded = Boolean(snapshot.context && snapshot.education && snapshot.status && snapshot.models);
  const readiness = useMemo(() => [
    { id: "core", label: "Core 与教育投影", complete: coreReady, action: onOpenSettings },
    { id: "model", label: "默认模型", complete: modelReady, action: onOpenModels },
    ...checklist.map((item) => ({
      id: item.id,
      label: item.label,
      complete: item.status === "complete",
      action: item.id === "identity" ? onOpenContext
        : item.id === "calendar" || item.id === "timetable" ? () => onNavigate("calendar")
          : item.id === "roster" ? () => onNavigate("students")
            : () => onNavigate("materials"),
    })),
  ], [checklist, coreReady, modelReady, onNavigate, onOpenContext, onOpenModels, onOpenSettings]);
  const completeCount = readiness.filter((item) => item.complete).length;
  const education = snapshot.education;
  const defaultModel = snapshot.models?.defaultModel;

  const keyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
    event.preventDefault();
    focusable[next].focus();
  };

  return <section ref={panelRef} className="edupi-admin-panel" role="dialog" aria-modal="true" aria-label="EduPi 管理中心" onKeyDownCapture={keyDown}>
    <header className="edupi-admin-panel__topbar">
      <div><span>EduPi</span><h1>管理中心</h1></div>
      <div><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button><button ref={closeRef} type="button" onClick={onClose}>返回工作台</button></div>
    </header>
    <main className="edupi-admin-panel__content" aria-busy={loading || undefined}>
      <section className="edupi-admin-readiness" aria-labelledby="edupi-admin-readiness-title">
        <header><div><span>上线就绪</span><h2 id="edupi-admin-readiness-title">EduPi 就绪度 {completeCount}/{readiness.length}</h2></div><strong>{loading ? "读取中" : !allSourcesLoaded ? "数据读取失败" : completeCount === readiness.length ? "已就绪" : "需要补充"}</strong></header>
        <div className="edupi-admin-readiness__bar" aria-hidden="true"><span style={{ width: `${readiness.length ? (completeCount / readiness.length) * 100 : 0}%` }} /></div>
        <div className="edupi-admin-readiness__items">{readiness.map((item) => <button type="button" key={item.id} onClick={item.action}><i className={item.complete ? "is-complete" : ""} aria-hidden="true">{item.complete ? "✓" : "·"}</i><span>{item.label}</span><em>{item.complete ? "完成" : "去设置"}</em></button>)}</div>
      </section>

      <section className="edupi-admin-grid" aria-label="管理模块">
        <article><span>AI 与模型</span><h2>{snapshot.models === null ? "模型数据不可用" : defaultModel ? `${defaultModel.provider} / ${defaultModel.modelId}` : "默认模型待配置"}</h2><small>{snapshot.models === null ? "检查模型服务" : `${snapshot.models.modelList?.length || 0} 个可用模型`}</small><button type="button" onClick={onOpenModels}>管理模型服务</button></article>
        <article><span>教师与学生</span><h2>{snapshot.context ? snapshot.context.configured ? snapshot.context.name || "教师身份已配置" : "教师身份待配置" : "教师数据不可用"}</h2><small>{education ? `${education.students.length} 份学生档案` : "学生档案不可用"}</small><div><button type="button" onClick={onOpenContext}>教师与学校</button><button type="button" onClick={() => onNavigate("students")}>学生档案</button><button type="button" onClick={onAskStudentUpdate}>让 EduPi 更新</button></div></article>
        <article><span>校历与课表</span><h2>{education ? `${education.calendar.length} 个校历节点` : "校历数据不可用"}</h2><small>{education ? `${education.timetable.length} 条课程安排` : "课程表不可用"}</small><button type="button" onClick={() => onNavigate("calendar")}>管理校历与课表</button></article>
        <article><span>上传内容</span><h2>{education ? `${education.intakeTargets.length} 项已接入` : "上传数据不可用"}</h2><button type="button" onClick={() => onNavigate("materials")}>管理上传内容</button></article>
        <article><span>任务与产物</span><h2>{education ? `${education.tasks.length} 项教师任务` : "任务数据不可用"}</h2><button type="button" onClick={() => onNavigate("workspace")}>打开工作区</button></article>
        <article><span>系统</span><h2>{coreReady ? "Core 已连接" : "Core 或教育投影不可用"}</h2><small>{education?.workspace || "数据目录待连接"}</small><button type="button" onClick={onOpenSettings}>应用与桌面设置</button></article>
      </section>
      <details className="edupi-admin-boundary"><summary>当前限制</summary><span>删除操作尚未接入；管理中心不会直接修改底层 JSON。</span></details>
    </main>
  </section>;
}
