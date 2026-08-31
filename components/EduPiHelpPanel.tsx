"use client";

import { useEffect, useState } from "react";
import type { OnboardingChecklistItem, TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";

type Props = {
  onClose: () => void;
  onStartSetup?: () => void;
  onOpenContext?: () => void;
};

const roleLabels: Record<string, string> = {
  subject_teacher: "任课教师",
  homeroom_teacher: "班主任",
  grade_group: "年级/备课组",
  academic_admin: "教务协作",
};

function statusLabel(item: OnboardingChecklistItem): string {
  if (item.status === "complete") return "已完成";
  if (item.status === "next") return "下一步";
  return "可稍后补充";
}

function compactItemLabel(item: OnboardingChecklistItem): string {
  const labels: Record<string, string> = {
    identity: "补齐身份",
    calendar: "导入校历",
    timetable: "补充课程",
    roster: "导入班级名单",
    material: "上传第一份材料",
  };
  return labels[item.id] ?? item.label;
}

function compactItemDescription(item: OnboardingChecklistItem): string {
  const descriptions: Record<string, string> = {
    identity: "称呼、学科、年级",
    calendar: "学校重要日期",
    timetable: "每周课程节奏",
    roster: "可稍后补充",
    material: "作业、错题或课堂记录",
  };
  return descriptions[item.id] ?? item.description.split(/[。；]/, 1)[0];
}

export function EduPiHelpPanel({ onClose, onStartSetup, onOpenContext }: Props) {
  const [context, setContext] = useState<TeacherContextSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/edupi/onboarding", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<TeacherContextSnapshot>;
      })
      .then(setContext)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="edupi-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="edupi-help-panel" role="dialog" aria-modal="true" aria-labelledby="edupi-help-title">
        <header className="edupi-help-panel__header">
          <div>
            <span className="edupi-help-panel__kicker">EduPi 教师工作台</span>
            <h2 id="edupi-help-title">新手引导</h2>
            <p>先补上下文，再开始工作。</p>
          </div>
          <button type="button" className="edupi-help-panel__close" onClick={onClose} aria-label="关闭帮助">×</button>
        </header>

        <div className="edupi-help-panel__body">
          <section className="edupi-help-first-step">
            <div className="edupi-help-first-step__number">01</div>
            <div>
              <span className="edupi-help-panel__kicker">当前步骤</span>
              <h3>{context?.configured ? "补齐上下文" : "告诉我你是谁"}</h3>
              <p>{context?.configured ? "导入校历或课程表。" : "填写称呼、学科和年级。"}</p>
              <button type="button" className="edupi-help-primary" onClick={context?.configured ? onOpenContext : onStartSetup}>{context?.configured ? "打开上下文" : "开始设置"}</button>
            </div>
          </section>

          <section className="edupi-help-section">
            <div className="edupi-help-section__heading"><h3>使用顺序</h3><span>随时可看</span></div>
            <div className="edupi-help-checklist">
              {(context?.checklist ?? [
                { id: "identity", label: "补齐身份", status: "next", description: "称呼、学科、年级" },
                { id: "calendar", label: "导入校历", status: "optional", description: "学校重要日期" },
                { id: "timetable", label: "补充课程", status: "optional", description: "每周课程节奏" },
                { id: "roster", label: "导入班级名单", status: "optional", description: "可稍后补充" },
                { id: "material", label: "上传第一份材料", status: "optional", description: "作业、错题或课堂记录" },
              ] as OnboardingChecklistItem[]).map((item) => (
                <div className={`edupi-help-checklist__item is-${item.status}`} key={item.id}>
                  <span className="edupi-help-checklist__mark">{item.status === "complete" ? "✓" : item.status === "next" ? "→" : "·"}</span>
                  <div><strong>{compactItemLabel(item)}</strong><span>{compactItemDescription(item)}</span></div>
                  <small>{statusLabel(item)}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="edupi-help-section edupi-help-examples">
            <div className="edupi-help-section__heading"><h3>可直接上传</h3><span>不必记菜单</span></div>
            <div className="edupi-help-example-grid">
              <div><strong>校历 / 通知</strong><span>核对日期后生成准备事项。</span></div>
              <div><strong>作业 / 错题</strong><span>归类问题，形成调整候选。</span></div>
              <div><strong>课堂记录</strong><span>整理观察，生成跟进候选。</span></div>
            </div>
          </section>

          <section className="edupi-help-boundary">
            <strong>安全边界</strong>
            <span>所有结果默认只面向教师内部；不会自动发送学生/家长内容。日期不确定、事实不足或高风险内容会停在“待审核”。</span>
          </section>
          {context ? <div className="edupi-help-context"><span>当前身份</span><strong>{context.name || "尚未设置称呼"}</strong><span>{context.subject || "学科待设置"} · {context.grade || "年级待设置"} · {context.roles.map((role) => roleLabels[role] ?? role).join("、")}</span></div> : null}
          {error ? <div className="edupi-help-error">帮助状态读取失败：{error}</div> : null}
        </div>
      </section>
    </div>
  );
}
