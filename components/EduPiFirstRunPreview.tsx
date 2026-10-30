"use client";

import { useEffect, useState, type ReactNode } from "react";

type PreviewProps = { step: number; expanded?: boolean; children?: ReactNode };
type Shape = "shelf" | "workspace" | "focus";

const TITLES = ["EduPi", "AI 协作", "教师资料", "班级", "日程", "材料", "教学", "首页"] as const;
const SHAPES: readonly Shape[] = ["shelf", "workspace", "focus", "shelf", "workspace", "shelf", "workspace", "focus"];

function SceneContent({ page }: { page: number }) {
  if (page === 0) return <div className="edupi-first-run__demo-welcome">
    <div className="edupi-first-run__welcome-feature">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="11" /><path d="M16 9v8l5 3" /></svg>
      <div><strong>提前交付</strong><span>截止前备好待办与材料</span></div>
    </div>
    <div className="edupi-first-run__welcome-feature">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="11" cy="10" r="3" /><circle cx="22" cy="12" r="3" /><path d="M4 25c0-5 3-8 7-8s7 3 7 8M17 19c3-2 9-1 11 6" /></svg>
      <div><strong>班级情况自动记忆</strong><span>学生情况在后续对话接着用</span></div>
    </div>
  </div>;
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

export function EduPiWelcomeScript() {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!document.fonts?.load) { setFontReady(true); return; }
    document.fonts.load('600 170px "EduPi Welcome Script"').then(
      () => { if (active) setFontReady(true); },
      () => { if (active) setFontReady(true); },
    );
    return () => { active = false; };
  }, []);

  return <div className={`edupi-first-run__welcome-script${fontReady ? " is-ready" : ""}`} aria-hidden="true"><span>Welcome</span><span>To</span><span>Edupi</span></div>;
}

export function EduPiFirstRunPreview({ step, expanded = false, children }: PreviewProps) {
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
    <div className="edupi-first-run__preview-chrome" aria-hidden="true"><span /><span /><span /><strong>{TITLES[shown]}</strong><em>EduPi</em></div>
    <div className="edupi-first-run__preview-body" aria-hidden="true">
      {outgoing !== null && outgoing !== shown ? <div className="edupi-first-run__demo-layer is-outgoing" key={`out-${outgoing}`}><SceneContent page={outgoing} /></div> : null}
      <div className="edupi-first-run__demo-layer is-current" key={`current-${shown}`}><SceneContent page={shown} /></div>
    </div>
    {expanded ? <div className="edupi-first-run__preview-form">{children}</div> : null}
  </div>;
}
