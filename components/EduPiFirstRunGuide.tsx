"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type Props = {
  suspended?: boolean;
  onOpenModels: () => void;
  onOpenContext: () => void;
  onEnterToday: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const STEPS = [
  { title: "连接模型", note: "添加模型与接口", action: "模型设置" },
  { title: "确认教师资料", note: "称呼、学科、年级", action: "教师资料" },
  { title: "进入今天", note: "从今天开始", action: "进入今天" },
] as const;

export function EduPiFirstRunGuide({
  suspended = false,
  onOpenModels,
  onOpenContext,
  onEnterToday,
  onComplete,
  onSkip,
}: Props) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }, []);

  useEffect(() => {
    if (!suspended) primaryRef.current?.focus();
  }, [step, suspended]);

  const leaveGuide = (callback: () => void) => {
    const returnTarget = returnFocusRef.current;
    callback();
    requestAnimationFrame(() => returnTarget?.focus());
  };

  const runPrimary = () => {
    if (step === 0) {
      setStep(1);
      onOpenModels();
      return;
    }
    if (step === 1) {
      setStep(2);
      onOpenContext();
      return;
    }
    onEnterToday();
    leaveGuide(onComplete);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      leaveGuide(onSkip);
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (buttons.length < 2) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (suspended) return null;
  const current = STEPS[step];

  return (
    <div className="edupi-first-run" role="presentation">
      <section
        ref={dialogRef}
        className="edupi-first-run__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edupi-first-run-title"
        aria-describedby="edupi-first-run-note"
        onKeyDown={handleKeyDown}
      >
        <div className="edupi-first-run__progress" aria-label={`第 ${step + 1} 步，共 ${STEPS.length} 步`}>
          {STEPS.map((item, index) => (
            <span key={item.title} className={index <= step ? "is-active" : ""} />
          ))}
        </div>
        <span className="edupi-first-run__step">{step + 1} / {STEPS.length}</span>
        <h2 id="edupi-first-run-title">{current.title}</h2>
        <p id="edupi-first-run-note">{current.note}</p>
        <button ref={primaryRef} type="button" className="edupi-first-run__primary" onClick={runPrimary}>
          {current.action}
        </button>
        <button type="button" className="edupi-first-run__skip" onClick={() => leaveGuide(onSkip)}>跳过</button>
      </section>
    </div>
  );
}
