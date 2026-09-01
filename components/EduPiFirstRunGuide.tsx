"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type Props = {
  onOpenModels: () => void;
  onOpenContext: () => void;
  onOpenCalendar: () => void;
  onOpenMaterials: () => void;
  onEnterToday: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const STEPS = [
  { title: "连接模型", note: "选择厂商，填入 API", action: "打开 AI 与模型" },
  { title: "确认教师资料", note: "称呼、学科、年级", action: "打开教师资料" },
  { title: "导入校历与课表", note: "把真实学期节奏交给 EduPi", action: "打开日程" },
  { title: "上传第一份材料", note: "作业、课堂记录或通知", action: "打开材料" },
  { title: "进入今天", note: "设置完成，开始工作", action: "进入今天" },
] as const;

export function EduPiFirstRunGuide({
  onOpenModels,
  onOpenContext,
  onOpenCalendar,
  onOpenMaterials,
  onEnterToday,
  onComplete,
  onSkip,
}: Props) {
  const [step, setStep] = useState(0);
  const [opened, setOpened] = useState(false);
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

  const runPrimary = () => {
    if (step === STEPS.length - 1) {
      onEnterToday();
      leaveGuide(onComplete);
      return;
    }
    if (opened) {
      setOpened(false);
      setStep((value) => value + 1);
      return;
    }
    setOpened(true);
    [onOpenModels, onOpenContext, onOpenCalendar, onOpenMaterials][step]?.();
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
        <button ref={primaryRef} type="button" className="edupi-first-run__primary" onClick={runPrimary}>
          {opened ? "完成，下一步" : current.action}
        </button>
        <button type="button" className="edupi-first-run__skip" onClick={() => leaveGuide(onSkip)}>稍后再说</button>
      </section>
    </aside>
  );
}
