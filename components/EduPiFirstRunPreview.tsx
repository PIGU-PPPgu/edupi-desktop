"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

type PreviewProps = { step: number; expanded?: boolean; introReady?: boolean; children?: ReactNode };
type Shape = "shelf" | "workspace" | "focus";

const TITLES = ["EduPi", "AI 协作", "教师资料", "班级", "日程", "材料", "教学", "首页"] as const;
const SHAPES: readonly Shape[] = ["shelf", "workspace", "focus", "shelf", "workspace", "shelf", "workspace", "focus"];

export const EDUPI_WELCOME_INTRO = [
  "你好，我是 EduPi。",
  "我想做你身边的教师助理，记住班里的变化，把临近的工作提前准备好。",
  "希望你少一点赶工，多一点时间留给学生，也留给自己。",
] as const;

function WelcomeIntro({ ready }: { ready: boolean }) {
  let delay = 0;
  const paragraphs = EDUPI_WELCOME_INTRO.map((line, lineIndex) => {
    const characters = Array.from(line).map((character, index) => {
      const hold = character === "。" ? 220 : character === "，" ? 110 : 32;
      const style = { "--intro-delay": `${delay}ms`, "--intro-hold": `${hold}ms` } as CSSProperties;
      delay += hold;
      return <span key={index} className="edupi-first-run__intro-char" style={style}>{character}</span>;
    });
    delay += 200;
    return lineIndex === 0 ? <strong key={lineIndex}>{characters}</strong> : <p key={lineIndex} className={lineIndex === 2 ? "edupi-first-run__intro-hope" : undefined}>{characters}</p>;
  });

  return <div className="edupi-first-run__demo-welcome" data-typing-ready={ready}>{paragraphs}</div>;
}

function SceneContent({ page, introReady = true }: { page: number; introReady?: boolean }) {
  if (page === 0) return <WelcomeIntro ready={introReady} />;
  if (page === 1) return <div className="edupi-first-run__demo-model">
    <div className="is-connection"><span>模型</span><i /><strong>EduPi</strong><i /><span>课堂</span></div>
    <div className="is-model-lines"><span /><span /><span /></div>
    <small>连接后，教学请求有了执行能力</small>
  </div>;
  if (page === 2) return <div className="edupi-first-run__demo-teacher">
    <div className="is-avatar">师</div><strong>数学教师</strong><small>七年级 · 任课教师</small>
    <div className="is-context"><span>学科</span><span>年级</span><span>班级</span></div>
  </div>;
  if (page === 3) return <div className="edupi-first-run__demo-roster">
    <div className="is-roster-icon">表</div><div className="is-roster-body"><strong>学生名单</strong><span>姓名　　班级　　记录</span><i /></div><em>自动识别</em>
  </div>;
  if (page === 4) return <div className="edupi-first-run__demo-calendar">
    <header><strong>行事历</strong><span>时间已就位</span></header>
    <div className="is-calendar-track"><i /><i /><i className="is-deadline" /><i /></div>
    <div className="is-calendar-work"><span>课程安排</span><strong>截止前准备</strong><span>教师确认</span></div>
  </div>;
  if (page === 5) return <div className="edupi-first-run__demo-files">
    <div><span>文</span><strong>教案</strong></div><div><span>表</span><strong>名单</strong></div><div><span>历</span><strong>校历</strong></div><em>来源可追溯</em>
  </div>;
  if (page === 6) return <div className="edupi-first-run__demo-teaching">
    <div className="is-next"><small>下一节课</small><strong>数学</strong><span>课前准备</span></div>
    <div className="is-artifacts"><span>教学设计</span><span>练习</span><span>答案</span></div>
  </div>;
  return <div className="edupi-first-run__demo-home">
    <strong>首页</strong><span>下一节课</span><span>待我确认</span><span>新建对话 ↗</span>
  </div>;
}

export function EduPiWelcomeScript({ onWritten }: { onWritten?: () => void }) {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!document.fonts?.load) { setFontReady(true); return; }
    const fallback = window.setTimeout(() => { if (active) setFontReady(true); }, 2500);
    document.fonts.load('600 170px "EduPi Welcome Script"').then(
      () => { window.clearTimeout(fallback); if (active) setFontReady(true); },
      () => { window.clearTimeout(fallback); if (active) setFontReady(true); },
    );
    return () => { active = false; window.clearTimeout(fallback); };
  }, []);

  useEffect(() => {
    if (!fontReady || !onWritten) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onWritten(); return; }
    const fallback = window.setTimeout(onWritten, 3000);
    return () => window.clearTimeout(fallback);
  }, [fontReady, onWritten]);

  return <div className={`edupi-first-run__welcome-script${fontReady ? " is-ready" : ""}`} aria-hidden="true"><span>Welcome</span><span>To</span><span onAnimationEnd={onWritten}>Edupi</span></div>;
}

export function EduPiFirstRunPreview({ step, expanded = false, introReady = true, children }: PreviewProps) {
  const page = Math.max(0, Math.min(step + 1, TITLES.length - 1));
  const [shown, setShown] = useState(page);
  const [outgoing, setOutgoing] = useState<number | null>(null);

  useEffect(() => {
    if (page === shown) return;
    setOutgoing(shown);
    setShown(page);
    const timer = window.setTimeout(() => setOutgoing(null), 420);
    return () => window.clearTimeout(timer);
  }, [page, shown]);

  return <div className="edupi-first-run__preview" data-shape={expanded ? "form" : SHAPES[page]} data-scene={page} aria-hidden={expanded ? undefined : true}>
    <div className="edupi-first-run__preview-chrome" aria-hidden="true"><span /><span /><span /><strong>{TITLES[shown]}</strong>{shown === 0 ? null : <em>EduPi</em>}</div>
    <div className="edupi-first-run__preview-body" aria-hidden="true">
      {outgoing !== null && outgoing !== shown ? <div className="edupi-first-run__demo-layer is-outgoing" key={`out-${outgoing}`}><SceneContent page={outgoing} introReady={introReady} /></div> : null}
      <div className="edupi-first-run__demo-layer is-current" key={`current-${shown}`}><SceneContent page={shown} introReady={introReady} /></div>
    </div>
    {expanded ? <div className="edupi-first-run__preview-form">{children}</div> : null}
  </div>;
}
