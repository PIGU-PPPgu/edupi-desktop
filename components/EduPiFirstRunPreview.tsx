type PreviewProps = { step: number };

const PREVIEW_TITLES = ["首页", "AI 协作", "教师资料", "班级", "日程", "材料", "教学", "首页"] as const;

export function EduPiFirstRunPreview({ step }: PreviewProps) {
  const page = Math.max(0, Math.min(step + 1, PREVIEW_TITLES.length - 1));
  return <div className="edupi-first-run__preview" aria-hidden="true">
    <div className="edupi-first-run__preview-chrome"><span /><span /><span /><strong>{PREVIEW_TITLES[page]}</strong><em>功能预览</em></div>
    <div className="edupi-first-run__preview-body">
      {page === 0 ? <div className="edupi-first-run__preview-home">
        <div className="is-hero"><small>今天</small><strong>你的教学工作，已经就位。</strong><span>下一节课 · 班级 · 日程</span></div>
        <div className="is-services"><span>备课</span><span>班级</span><span>日程</span></div>
      </div> : null}
      {page === 1 ? <div className="edupi-first-run__preview-chat">
        <p>帮我准备下一节课</p><div><span className="is-orb" /><strong>已整理课前要点</strong><small>结合课程、材料与班级记录</small></div>
      </div> : null}
      {page === 2 ? <div className="edupi-first-run__preview-context">
        <div className="is-avatar">师</div><div><small>教学背景</small><strong>数学教师</strong><span>七年级 · 本学期</span></div>
      </div> : null}
      {page === 3 ? <div className="edupi-first-run__preview-students">
        <div><span>01</span><strong>学生档案</strong><small>学习记录</small></div>
        <div><span>02</span><strong>成长轨迹</strong><small>持续更新</small></div>
        <div><span>03</span><strong>班级观察</strong><small>关联教学</small></div>
      </div> : null}
      {page === 4 ? <div className="edupi-first-run__preview-calendar">
        <header><strong>本周日程</strong><span>10 月</span></header>
        <div className="is-week"><span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span></div>
        <div className="is-events"><i /><i /><i /><i /><i /></div>
      </div> : null}
      {page === 5 ? <div className="edupi-first-run__preview-materials">
        <div><span>文</span><strong>课程资料</strong><small>教案与课件</small></div>
        <div><span>表</span><strong>班级名单</strong><small>Excel · CSV</small></div>
        <div><span>历</span><strong>校历课表</strong><small>学期节奏</small></div>
      </div> : null}
      {page === 6 ? <div className="edupi-first-run__preview-teaching">
        <div className="is-lesson"><small>下一节课</small><strong>数学</strong><span>课前准备</span></div>
        <div className="is-output"><span>教学设计</span><span>练习</span><span>答案</span></div>
      </div> : null}
      {page === 7 ? <div className="edupi-first-run__preview-today">
        <div><small>首页</small><strong>从这里开始</strong></div>
        <span>准备下一节课</span><span>查看待处理</span><span>新建对话 ↗</span>
      </div> : null}
    </div>
  </div>;
}
