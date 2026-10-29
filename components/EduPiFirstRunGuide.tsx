"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { readEduPiWorkspace, type EduPiWorkspaceBundle } from "@/lib/edupi-education-client";
import { APP_PREF_KEYS, getPref, setPref } from "@/lib/app-prefs";
import { EduPiFirstRunPreview } from "./EduPiFirstRunPreview";

type Props = {
  onOpenModels: () => void;
  onOpenContext: () => void;
  onOpenCalendar: () => void;
  onOpenMaterials: () => void;
  onOpenStudents: () => void;
  onOpenTeaching: () => void;
  onEnterToday: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const STEPS = [
  { title: "连接模型", note: "提问、备课和整理材料，都从 AI 协作开始。", action: "打开 AI 与模型" },
  { title: "确认教师资料", note: "学科和年级会成为每次协作的背景。", action: "打开教师资料" },
  { title: "导入学生名单", note: "在班级里查看学习记录与成长轨迹。", action: "打开班级" },
  { title: "导入校历与课表", note: "课程、活动和待办在日程里汇合。", action: "打开日程" },
  { title: "上传第一份材料", note: "把作业、课件和通知放进工作区。", action: "打开材料" },
  { title: "第一次备课", note: "从课程和已有材料生成课前准备。", action: "打开教学" },
  { title: "进入首页", note: "继续处理下一节课、待办或对话。", action: "进入首页" },
] as const;
const WELCOME = { title: "欢迎使用 EduPi", note: "备课、班级、日程和 AI 协作，从这里开始。", action: "开始探索" } as const;

export function isGuideStepReady(step: number, bundle: EduPiWorkspaceBundle): boolean {
  if (step === 1) return Boolean(bundle.context.configured);
  if (step === 2) return bundle.data.students.length > 0;
  if (step === 3) return bundle.data.timetable.length > 0 && bundle.data.calendar.length > 0;
  if (step === 4) return bundle.context.checklist.some((item) => item.id === "material" && item.status === "complete");
  if (step === 5) return bundle.data.workCases.some((item) => item.kind === "teaching_before_class" && item.artifactIds.length > 0 && ["draft_ready", "accepted", "modified", "completed"].includes(item.currentState));
  return false;
}

export function EduPiFirstRunGuide({
  onOpenModels,
  onOpenContext,
  onOpenCalendar,
  onOpenMaterials,
  onOpenStudents,
  onOpenTeaching,
  onEnterToday,
  onComplete,
  onSkip,
}: Props) {
  const [step, setStep] = useState(() => { const saved = Number(getPref(APP_PREF_KEYS.edupiFirstRunGuideStep)); return Number.isInteger(saved) && saved >= 0 && saved < STEPS.length ? saved : 0; });
  const [welcome, setWelcome] = useState(() => getPref(APP_PREF_KEYS.edupiFirstRunWelcomeSeen) !== "true" || getPref(APP_PREF_KEYS.edupiFirstRunGuideComplete) === "true");
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step, welcome]);

  const leaveGuide = (callback: () => void) => {
    const returnTarget = returnFocusRef.current;
    callback();
    requestAnimationFrame(() => returnTarget?.focus());
  };

  const advance = () => { setFeedback(null); setOpened(false); setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, String(step + 1)); setStep((value) => value + 1); };
  const previous = () => { if (checking || step === 0) return; setFeedback(null); setOpened(false); setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, String(step - 1)); setStep((value) => value - 1); };
  const runPrimary = async () => {
    if (welcome) {
      setPref(APP_PREF_KEYS.edupiFirstRunWelcomeSeen, "true");
      if (getPref(APP_PREF_KEYS.edupiFirstRunGuideStep) === null) setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, "0");
      setWelcome(false);
      return;
    }
    if (step === STEPS.length - 1) {
      setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, "0");
      onEnterToday();
      leaveGuide(onComplete);
      return;
    }
    if (opened) {
      setChecking(true); setFeedback(null);
      try {
        let ready;
        if (step === 0) {
          const workspace = await readEduPiWorkspace();
          const response = await fetch(`/api/models?cwd=${encodeURIComponent(workspace.data.workspace)}`, {cache:"no-store"});
          if (!response.ok) throw new Error("配置读取失败，请重试");
          const models = await response.json() as { defaultModel?: { provider: string; modelId: string }; modelList?: Array<{provider:string;id:string}> };
          ready = Boolean(models.defaultModel && models.modelList?.some((model) => model.provider === models.defaultModel?.provider && model.id === models.defaultModel?.modelId));
        } else ready = isGuideStepReady(step, await readEduPiWorkspace());
        if (ready) advance();
        else setFeedback(step === 5 ? "尚未生成备课材料，可在教学页点击立即检查" : "尚未完成保存，可继续设置或跳过此步");
      } catch { setFeedback("暂时无法检查，请重试"); }
      finally { setChecking(false); }
      return;
    }
    setOpened(true);
    [onOpenModels, onOpenContext, onOpenStudents, onOpenCalendar, onOpenMaterials, onOpenTeaching][step]?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      leaveGuide(onSkip);
      return;
    }
    if (event.key !== "Tab" || opened) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const current = welcome ? WELCOME : STEPS[step];
  const position = welcome ? 0 : step + 1;
  const total = STEPS.length + 1;
  return (
    <aside className={`edupi-first-run${opened ? " is-opened" : ""}`} role={opened ? "region" : "dialog"} aria-modal={opened ? undefined : true} aria-labelledby="edupi-first-run-title" onKeyDown={handleKeyDown}>
      <section className="edupi-first-run__dialog">
        {!opened ? <div className="edupi-first-run__top"><strong>EduPi</strong><span>教师工作台</span><button type="button" className="edupi-first-run__quiet" onClick={() => leaveGuide(onSkip)}>稍后再说</button></div> : null}
        {!opened ? <div className="edupi-first-run__scene" key={`scene-${position}`}><EduPiFirstRunPreview step={welcome ? -1 : step} /></div> : null}
        <div className="edupi-first-run__content" key={`copy-${position}`}>
          {!opened ? <div className="edupi-first-run__progress" aria-label={`第 ${position + 1} 步，共 ${total} 步`}>
            {Array.from({ length: total }, (_, index) => <span key={index} className={index <= position ? "is-active" : ""} />)}
          </div> : null}
          {!opened ? <span className="edupi-first-run__step">{String(position + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span> : null}
          <h2 id="edupi-first-run-title">{current.title}</h2>
          {!opened ? <p>{current.note}</p> : null}
          {feedback ? <p className="edupi-first-run__feedback" role="status">{feedback}</p> : null}
          <button ref={primaryRef} type="button" className="edupi-first-run__primary" disabled={checking} onClick={() => void runPrimary()}>
            {checking ? "检查中…" : opened ? "检查并继续" : current.action}
          </button>
          <div className="edupi-first-run__secondary">
            {step > 0 && !welcome ? <button type="button" className="edupi-first-run__skip" disabled={checking} onClick={previous}>上一步</button> : null}
            {step < STEPS.length - 1 && !welcome ? <button type="button" className="edupi-first-run__skip" disabled={checking} onClick={advance}>跳过此步</button> : null}
            {opened ? <button type="button" className="edupi-first-run__skip" onClick={() => leaveGuide(onSkip)}>稍后再说</button> : null}
          </div>
        </div>
      </section>
    </aside>
  );
}
