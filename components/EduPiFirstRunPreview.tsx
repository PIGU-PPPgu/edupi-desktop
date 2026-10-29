"use client";

import { useEffect, useState, type ReactNode } from "react";

type PreviewProps = { step: number; expanded?: boolean; children?: ReactNode };
type Shape = "shelf" | "workspace" | "focus";

const TITLES = ["EduPi", "AI 协作", "教师资料", "班级", "日程", "材料", "教学", "首页"] as const;
const SHAPES: readonly Shape[] = ["shelf", "workspace", "focus", "shelf", "workspace", "shelf", "workspace", "focus"];

function SceneContent({ page }: { page: number }) {
  if (page === 0) return <div className="edupi-first-run__demo-welcome">
    <svg className="edupi-first-run__handwriting" viewBox="0 0 270 140" fill="none" aria-hidden="true">
      <path d="M28 112 C35 78 43 43 45 29 C48 17 41 16 37 27 C30 48 26 90 26 115 M31 84 C45 66 60 63 65 73 C70 84 60 105 66 114 C69 118 76 115 82 109" />
      <path d="M88 96 C106 95 118 88 114 79 C111 71 99 74 92 83 C82 96 84 111 98 115 C108 118 120 113 126 108" />
      <path d="M147 27 C144 55 132 92 134 108 C135 117 146 117 154 107" />
      <path d="M178 25 C174 57 165 90 166 107 C168 118 180 116 188 107" />
      <path d="M218 84 C204 88 196 107 204 115 C213 124 233 112 239 98 C244 86 235 79 224 84 C211 89 206 108 215 116" />
    </svg>
    <div className="edupi-first-run__welcome-shelf"><strong>EduPi</strong><span>备课</span><span>班级</span><span>日程</span></div>
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
