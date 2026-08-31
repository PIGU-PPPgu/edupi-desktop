"use client";

import type { TaskReviewAction, TeacherTask } from "@/lib/edupi-education-contract";

type Props = {
  task: TeacherTask;
  enabled: boolean;
  busy: boolean;
  onAction: (action: TaskReviewAction) => void;
};

function value(value: unknown, fallback = "待核对"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function taskStatus(status: TeacherTask["status"]): string {
  return { planned: "待审核", accepted: "已接受", modified: "已修改", rejected: "已拒绝", hold: "已暂缓" }[status];
}

function evidenceLines(evidence: Record<string, unknown>): Array<[string, string]> {
  return [
    ["来源记忆", value(evidence.source_memory)],
    ["来源条目", value(evidence.source_entry_id)],
    ["事实摘要", value(evidence.source_summary)],
    ["推断状态", value(evidence.inference_status, "不是推断")],
    ["规则", value(evidence.rule)],
  ].filter(([, line]) => line !== "待核对") as Array<[string, string]>;
}

export function EduPiReviewTaskCard({ task, enabled, busy, onAction }: Props) {
  const history = task.reviewHistory.slice(-3).reverse();
  const isMaterial = task.trigger === "teaching_adjustment_candidate";
  const isHold = task.status === "hold";
  return (
    <article className="edupi-review-card">
      <div className="edupi-review-card__main">
        <div className="edupi-review-badges">
          <span className={`edupi-review-kind edupi-review-kind--${isMaterial ? "material" : task.trigger === "student_follow_up" ? "student" : "calendar"}`}>{isMaterial ? "教学调整候选" : task.trigger === "student_follow_up" ? "学生跟进" : "校历准备"}</span>
          <span className="edupi-review-scope">教师内部</span>
          <span className="edupi-review-status">{taskStatus(task.status)}</span>
        </div>
        <h3>{task.title}</h3>
        <div className="edupi-review-source-line">来源：{value(task.sourceEventName)} · 日期：{value(task.dueDate, "日期待确认")}</div>
        <div className="edupi-review-fact-grid">
          <div><span>事实来源</span><strong>{value(task.materialId || task.sourceEventId)}</strong></div>
          <div><span>材料类型</span><strong>{value(task.materialKind || task.studentEventType, "校历/事件")}</strong></div>
          <div><span>交付对象</span><strong>{task.audience.join("、") || "教师"}</strong></div>
          <div><span>当前修订</span><strong>r{task.revision}</strong></div>
        </div>
        <details className="edupi-review-evidence" open={isMaterial}>
          <summary>查看证据与边界</summary>
          <div className="edupi-review-evidence__body">
            {evidenceLines(task.evidence).map(([label, line]) => <div key={label}><span>{label}</span><p>{line}</p></div>)}
            <div><span>系统边界</span><p>candidate_only；不会自动诊断、不会自动写入学生正式事实、不会外发。</p></div>
          </div>
        </details>
        {history.length > 0 ? <details className="edupi-review-history"><summary>最近审核记录（{task.reviewHistory.length}）</summary><div>{history.map((event, index) => <p key={`${String(event.review_id || event.reviewed_at)}-${index}`}>{value(event.action)} → {value(event.next_status)} · {value(event.reviewer)} · {value(event.note, "无备注")}</p>)}</div></details> : null}
      </div>
      <div className="edupi-review-actions" aria-label="任务审核动作">
        <button type="button" disabled={!enabled || busy} onClick={() => onAction("accept")}>接受</button>
        <button type="button" disabled={!enabled || busy} onClick={() => onAction("hold")}>暂缓</button>
        <button type="button" disabled={!enabled || busy} onClick={() => onAction(isHold ? "rollback" : "reject")}>{isHold ? "撤销暂缓" : "拒绝"}</button>
      </div>
    </article>
  );
}
