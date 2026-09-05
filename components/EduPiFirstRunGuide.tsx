"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { readEduPiWorkspace, type EduPiWorkspaceBundle } from "@/lib/edupi-education-client";
import { APP_PREF_KEYS, getPref, setPref } from "@/lib/app-prefs";

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
  { title: "连接模型", note: "选择厂商，填入 API", action: "打开 AI 与模型" },
  { title: "确认教师资料", note: "称呼、学科、年级", action: "打开教师资料" },
  { title: "导入学生名单", note: "支持 Excel 和 CSV，先预览再导入", action: "打开班级" },
  { title: "导入校历与课表", note: "把真实学期节奏交给 EduPi", action: "打开日程" },
  { title: "上传第一份材料", note: "作业、课堂记录或通知", action: "打开材料" },
  { title: "第一次备课", note: "检查课程准备，打开生成的材料", action: "打开教学" },
  { title: "进入今天", note: "查看准备结果和待办", action: "进入今天" },
] as const;

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
  }, [step]);

  const leaveGuide = (callback: () => void) => {
    const returnTarget = returnFocusRef.current;
    callback();
    requestAnimationFrame(() => returnTarget?.focus());
  };

  const advance = () => { setFeedback(null); setOpened(false); setPref(APP_PREF_KEYS.edupiFirstRunGuideStep, String(step + 1)); setStep((value) => value + 1); };
  const runPrimary = async () => {
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
    if (event.key !== "Escape") return;
    event.preventDefault();
    leaveGuide(onSkip);
  };

  const current = STEPS[step];
  return (
    <aside className="edupi-first-run" role="region" aria-labelledby="edupi-first-run-title" onKeyDown={handleKeyDown}>
      <section className="edupi-first-run__dialog">
        <div className="edupi-first-run__progress" aria-label={`第 ${step + 1} 步，共 ${STEPS.length} 步`}>
          {STEPS.map((item, index) => <span key={item.title} className={index <= step ? "is-active" : ""} />)}
        </div>
        <span className="edupi-first-run__step">{step + 1} / {STEPS.length}</span>
        <h2 id="edupi-first-run-title">{current.title}</h2>
        <p>{current.note}</p>
        {feedback ? <p role="status">{feedback}</p> : null}
        <button ref={primaryRef} type="button" className="edupi-first-run__primary" disabled={checking} onClick={() => void runPrimary()}>
          {checking ? "检查中…" : opened ? "检查并继续" : current.action}
        </button>
        {step < STEPS.length - 1 ? <button type="button" className="edupi-first-run__skip" disabled={checking} onClick={advance}>跳过此步</button> : null}
        <button type="button" className="edupi-first-run__skip" onClick={() => leaveGuide(onSkip)}>稍后再说</button>
      </section>
    </aside>
  );
}
