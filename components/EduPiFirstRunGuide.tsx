"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { readEduPiWorkspace, type EduPiWorkspaceBundle } from "@/lib/edupi-education-client";
import { APP_PREF_KEYS, getPref, setPref } from "@/lib/app-prefs";
import { isTeachingModelIneligible } from "@/lib/model-setup-presets";
import { fetchPrivateModelApi } from "@/lib/desktop-native";
import { EduPiFirstRunPreview } from "./EduPiFirstRunPreview";
import { EduPiOnboardingTeacherForm } from "./EduPiOnboardingTeacherForm";
import { EduPiOnboardingRoster } from "./EduPiOnboardingRoster";
import { EduPiOnboardingCalendarUpload } from "./EduPiOnboardingCalendarUpload";

const EduPiOnboardingModelSetup = dynamic(() => import("./EduPiOnboardingModelSetup").then((module) => module.EduPiOnboardingModelSetup), { ssr: false });

type Props = {
  onOpenModels: () => void;
  onOpenContext: () => void;
  onOpenCalendar: () => void;
  onOpenMaterials: () => void;
  onOpenStudents: () => void;
  onOpenTeaching: () => void;
  onModelSaved?: () => void;
  onEnterToday: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const STEPS = [
  { title: "连接模型", note: "为备课和复杂名单连接通用 API。", action: "选择模型" },
  { title: "确认教师资料", note: "学科和年级会成为每次协作的背景。", action: "填写教师资料" },
  { title: "导入学生名单", note: "上传名单，清晰数据自动入库。", action: "上传名单" },
  { title: "导入行事历与课表", note: "按真实日期提前准备待办与材料。", action: "上传行事历" },
  { title: "上传第一份材料", note: "把作业、课件和通知放进工作区。", action: "打开材料" },
  { title: "第一次备课", note: "从课程和已有材料生成课前准备。", action: "打开教学" },
  { title: "进入首页", note: "继续处理下一节课、待办或对话。", action: "进入首页" },
] as const;
const WELCOME = { title: "欢迎使用 EduPi", note: "备课、班级、日程与 AI 协作。", action: "开始探索" } as const;

export function isGuideStepReady(step: number, bundle: EduPiWorkspaceBundle): boolean {
  if (step === 1) return Boolean(bundle.context.configured && bundle.context.name?.trim() && bundle.context.subject?.trim() && bundle.context.grade?.trim());
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
  onModelSaved,
  onEnterToday,
  onComplete,
  onSkip,
}: Props) {
  const [step, setStep] = useState(() => { const saved = Number(getPref(APP_PREF_KEYS.edupiFirstRunGuideStep)); return Number.isInteger(saved) && saved >= 0 && saved < STEPS.length ? saved : 0; });
  const [welcome, setWelcome] = useState(() => getPref(APP_PREF_KEYS.edupiFirstRunWelcomeSeen) !== "true" || getPref(APP_PREF_KEYS.edupiFirstRunGuideComplete) === "true");
  const [opened, setOpened] = useState(false);
  const [inline, setInline] = useState<"model" | "teacher" | "roster" | "calendar" | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [artReady, setArtReady] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const flowVersionRef = useRef(0);
  const inlineBusyRef = useRef(false);
  const inlineVersion = flowVersionRef.current;
  const onInlineBusyChange = useCallback((busy: boolean) => {
    if (flowVersionRef.current === inlineVersion) { inlineBusyRef.current = busy; setInlineBusy(busy); }
  }, [inlineVersion]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    const art = new Image();
    let active = true;
    const reveal = () => { if (active) setArtReady(true); };
    art.onload = reveal;
    art.onerror = reveal;
    art.src = "/onboarding/edupi-night-campus.webp";
    if (art.complete) reveal();
    return () => { active = false; art.onload = null; art.onerror = null; };
  }, []);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step, welcome]);

  useEffect(() => { if (inline) inlineRef.current?.focus({ preventScroll: true }); }, [inline]);

  const leaveGuide = (callback: () => void) => {
    if (checking || inline && inlineBusyRef.current) return;
    const returnTarget = returnFocusRef.current;
    flowVersionRef.current += 1;
    callback();
    requestAnimationFrame(() => returnTarget?.focus());
  };

  const advance = () => { flowVersionRef.current += 1; inlineBusyRef.current = false; setFeedback(null); setOpened(false); setInline(null); setInlineBusy(false); setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, String(step + 1)); setStep((value) => value + 1); };
  const skipInline = () => { if (!inlineBusyRef.current) advance(); };
  const advanceIfCurrent = (version: number) => { if (flowVersionRef.current === version) advance(); };
  const previous = () => { if (checking || inlineBusyRef.current || step === 0) return; flowVersionRef.current += 1; inlineBusyRef.current = false; setFeedback(null); setOpened(false); setInline(null); setInlineBusy(false); setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, String(step - 1)); setStep((value) => value - 1); };
  const closeInline = () => { if (inlineBusyRef.current) return; flowVersionRef.current += 1; inlineBusyRef.current = false; setInline(null); setInlineBusy(false); };
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
    if (!opened && step < 4) {
      flowVersionRef.current += 1;
      inlineBusyRef.current = false;
      setInline((["model", "teacher", "roster", "calendar"] as const)[step]);
      setInlineBusy(false);
      return;
    }
    if (opened) {
      const checkVersion = flowVersionRef.current;
      setChecking(true); setFeedback(null);
      try {
        let ready;
        if (step === 0) {
          const workspace = await readEduPiWorkspace();
          const response = await fetch(`/api/models?cwd=${encodeURIComponent(workspace.data.workspace)}`, {cache:"no-store"});
          if (!response.ok) throw new Error("配置读取失败，请重试");
          const models = await response.json() as { defaultModel?: { provider: string; modelId: string }; modelList?: Array<{provider:string;id:string}> };
          if (models.defaultModel && isTeachingModelIneligible(models.defaultModel.provider)) {
            setFeedback("编程套餐不能用于自动备课，请连接通用 API 模型");
            return;
          }
          const eligibilityResponse = await fetchPrivateModelApi("/api/models-config/default", { cache: "no-store" });
          if (!eligibilityResponse.ok) throw new Error("默认模型状态读取失败");
          const eligibility = await eligibilityResponse.json() as { eligible?: boolean; reason?: string };
          if (eligibility.reason === "coding_plan") { setFeedback("编程套餐不能用于自动备课，请连接通用 API 模型"); return; }
          ready = eligibility.eligible === true && Boolean(models.defaultModel && models.modelList?.some((model) => model.provider === models.defaultModel?.provider && model.id === models.defaultModel?.modelId));
        } else ready = isGuideStepReady(step, await readEduPiWorkspace());
        if (flowVersionRef.current !== checkVersion) return;
        if (ready) advance();
        else setFeedback(step === 5 ? "尚未生成备课材料，可在教学页点击立即检查" : "尚未完成保存，可继续设置或跳过此步");
      } catch { if (flowVersionRef.current === checkVersion) setFeedback("暂时无法检查，请重试"); }
      finally { if (flowVersionRef.current === checkVersion) setChecking(false); }
      return;
    }
    setOpened(true);
    [onOpenModels, onOpenContext, onOpenStudents, onOpenCalendar, onOpenMaterials, onOpenTeaching][step]?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (inline) { closeInline(); return; }
      leaveGuide(onSkip);
      return;
    }
    if (event.key !== "Tab" || opened) return;
    const focusables = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')).filter((element) => element.offsetParent !== null);
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const current = welcome ? WELCOME : STEPS[step];
  const position = welcome ? 0 : step + 1;
  const total = STEPS.length + 1;
  return (
    <aside className={`edupi-first-run${opened ? " is-opened" : ""}${inline ? " is-inline" : ""}${welcome && !opened && !inline ? " is-welcome" : ""}`} role={opened ? "region" : "dialog"} aria-modal={opened ? undefined : true} aria-label={inline ? current.title : undefined} aria-labelledby={inline ? undefined : "edupi-first-run-title"} onKeyDown={handleKeyDown}>
      <section className="edupi-first-run__dialog">
        <div className={`edupi-first-run__art${artReady ? " is-ready" : ""}`} aria-hidden="true" />
        {!opened ? <div className="edupi-first-run__top">{inline ? <button type="button" className="edupi-first-run__quiet" disabled={inlineBusy} onClick={closeInline}>返回</button> : null}<strong>EduPi</strong><span>教师工作台</span><button type="button" className="edupi-first-run__quiet" disabled={inlineBusy} onClick={() => leaveGuide(onSkip)}>稍后再说</button></div> : null}
        {!opened ? <div className="edupi-first-run__scene"><EduPiFirstRunPreview step={welcome ? -1 : step} expanded={Boolean(inline)}>
        {inline ? <div ref={inlineRef} className="edupi-first-run__inline" tabIndex={-1} key={`inline-${step}`}>
          {inline === "model" ? <EduPiOnboardingModelSetup onBusyChange={onInlineBusyChange} onComplete={() => { if (flowVersionRef.current !== inlineVersion) return; onModelSaved?.(); advance(); }} onAdvanced={() => { if (inlineBusyRef.current) return; flowVersionRef.current += 1; setInline(null); setOpened(true); onOpenModels(); }} /> : null}
          {inline === "teacher" ? <EduPiOnboardingTeacherForm onBusyChange={onInlineBusyChange} onComplete={() => advanceIfCurrent(inlineVersion)} /> : null}
          {inline === "roster" ? <EduPiOnboardingRoster onBusyChange={onInlineBusyChange} onComplete={() => advanceIfCurrent(inlineVersion)} /> : null}
          {inline === "calendar" ? <EduPiOnboardingCalendarUpload onBusyChange={onInlineBusyChange} onComplete={() => advanceIfCurrent(inlineVersion)} onReview={() => { if (inlineBusyRef.current) return; flowVersionRef.current += 1; setInline(null); setOpened(true); onOpenMaterials(); }} onOpenCalendar={() => { if (inlineBusyRef.current) return; flowVersionRef.current += 1; setInline(null); setOpened(true); onOpenCalendar(); }} /> : null}
          <button type="button" className="edupi-first-run__inline-skip" disabled={inlineBusy} onClick={skipInline}>跳过此步</button>
        </div> : null}
        </EduPiFirstRunPreview></div> : null}
        {!inline ? <div className="edupi-first-run__content" key={`copy-${position}`}>
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
            {opened ? <button type="button" className="edupi-first-run__skip" disabled={checking} onClick={() => leaveGuide(onSkip)}>稍后再说</button> : null}
          </div>
        </div> : null}
      </section>
    </aside>
  );
}
