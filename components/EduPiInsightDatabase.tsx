"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { useStudentObservationRows } from "@/hooks/useStudentObservationRows";
import { INSIGHT_CATEGORIES, INSIGHT_STATUSES, insightCategory, routePart, type InsightCategoryId, type InsightStatusId } from "@/lib/edupi-domain-navigation";

const PAGE_SIZE = 8;

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

type ReviewTarget = { kind: "observation" | "memory_candidate"; id: string };
type InsightRow = {
  id: string;
  type: string;
  content: string;
  status: string;
  statusId: string;
  evidence: string[];
  metric: string;
  date: string | null;
  related: string[];
  sources?: string[];
  reviewTarget?: ReviewTarget;
  reviewTargets?: ReviewTarget[];
  sourceText?: string;
  sourceSessionId?: string | null;
};

function observationEvidenceIds(item: EducationContract["observations"][number]): string[] {
  return [...item.evidenceIds, ...item.provenance.flatMap(source => [source.sourceId, ...source.evidenceIds])];
}

function uniqueSources(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function EduPiInsightDatabase({ data, query, selectedObjectId, onReviewTarget }: { data: EducationContract; query: string; selectedObjectId: string | null; onReviewTarget?: (target: ReviewTarget) => void }) {
  const [category = "learning", status = "all"] = routePart(selectedObjectId, "insights", "learning:all").split(":") as [InsightCategoryId, InsightStatusId];
  const [page, setPage] = useState(0);
  const studentObservations = useStudentObservationRows(category, status, query, page);
  const categoryLabel = INSIGHT_CATEGORIES.find((item) => item.id === category)?.label || "学情观察";
  const statusLabel = INSIGHT_STATUSES.find((item) => item.id === status)?.label || "全部";
  const rows = useMemo<InsightRow[]>(() => {
    const observations = data.observations.filter((item) => insightCategory(item.text) === category).map((item) => ({ id: `observation:${item.observationId}`, type: "原始观察", content: item.text, status: item.teacherReview.state === "accepted" ? "已确认" : item.teacherReview.state === "rejected" ? "已拒绝" : item.teacherReview.state === "held" ? "已暂缓" : "待确认", statusId: "observation", evidence: item.evidenceIds, metric: `${item.evidenceIds.length} 条`, date: item.observedAt, related: [...item.studentIds, ...(item.classId ? [item.classId] : [])], sources: uniqueSources([...item.provenance.map(source => `${source.sourceKind} · ${source.sourceId}`), ...item.evidenceIds.map(id => `证据 · ${id}`)]), reviewTarget: { kind: "observation" as const, id: item.observationId } }));
    const observationsByEvidence = new Map<string, EducationContract["observations"][number]>();
    for (const observation of data.observations) for (const evidenceId of observationEvidenceIds(observation)) observationsByEvidence.set(evidenceId, observation);
    const insights = data.continuity.insights.filter((item) => !item.content.startsWith("[主题候选]") && insightCategory(item.content) === category).map((item) => {
      const linkedObservations = [...new Set(item.evidenceIds.map(evidenceId => observationsByEvidence.get(evidenceId)).filter((observation): observation is EducationContract["observations"][number] => Boolean(observation)))];
      return { id: `insight:${item.id}`, type: "洞察", content: item.content.replace(/^\[梦境启示\]\s*/, ""), status: item.status === "surfaced" ? "已浮出" : "酝酿中", statusId: item.status, evidence: item.evidenceIds, metric: `${Math.round(item.confidence * 100)}%`, date: item.surfacedAt || item.createdAt, related: [] as string[], sources: uniqueSources([...item.evidenceIds.map(id => `证据 · ${id}`), ...linkedObservations.map(observation => `原始观察 · ${observation.observationId}`)]), reviewTargets: linkedObservations.map(observation => ({ kind: "observation" as const, id: observation.observationId })) };
    });
    const signals = data.continuity.signals.filter((item) => insightCategory(item.content) === category).map((item) => ({ id: `signal:${item.id}`, type: "弱信号", content: item.content, status: "持续观察", statusId: "signal", evidence: [] as string[], metric: `${item.strength} 次`, date: item.lastSeenAt || item.createdAt, related: item.related, sources: item.related.map(source => `关联 · ${source}`) }));
    const studentRows = studentObservations.records.map(item => ({ id: `student-event:${item.id}`, type: item.kind === "learning" ? "学习记录" : "互动记录", content: [item.canonical_topic || item.topic, item.summary].filter(Boolean).join(" · "), status: "教师记录", statusId: "observation", evidence: [item.source?.message_id].filter(Boolean), metric: `版本 ${item.revision}`, date: item.recorded_at, related: item.student_labels || item.students, sourceText: item.source?.text || "", sourceSessionId: item.source?.session_id || null }));
    return [...observations, ...insights, ...signals, ...studentRows]
      .filter((item) => status === "all" || item.statusId === status)
      .filter((item) => !query || `${item.content} ${item.status} ${item.evidence.join(" ")} ${item.related.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  }, [category, data.continuity.insights, data.continuity.signals, data.observations, query, status, studentObservations.records]);
  useEffect(() => setPage(0), [category, query, status]);
  const total = rows.filter(item => !item.id.startsWith("student-event:")).length + studentObservations.total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const sourceAvailable = data.dataSources.insights.present || data.observations.length > 0 || studentObservations.connected;
  const emptyMessage = !sourceAvailable
    ? "观察与洞察数据尚未接入"
    : query || status !== "all"
      ? "当前筛选暂无记录"
      : "数据已连接，当前没有该类记录";

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><h1>{categoryLabel}</h1><p>{sourceAvailable ? "数据已连接" : "数据未接入"} · {statusLabel} · {total} 条记录</p></div></header>
    {studentObservations.error ? <p role="alert">{studentObservations.error}</p> : null}
    <section className="edupi-database" aria-label={`${categoryLabel}数据库`}>
      <div className="edupi-database__head edupi-insight-db-grid"><span>类型</span><span>内容</span><span>状态</span><span>依据</span><span>最近时间</span></div>
      {visible.map((item) => <details className="edupi-database-row" key={item.id}>
        <summary className="edupi-insight-db-grid"><span>{item.type}</span><strong>{item.content}</strong><span>{item.status}</span><span>{item.evidence.length || item.related.length}</span><time>{shortDate(item.date)}</time></summary>
        <div className="edupi-database-row__detail">
          <div><span>强度 / 置信度</span><strong>{item.metric}</strong></div>
          <div><span>关联</span><strong>{item.related.join("、") || "—"}</strong></div>
          <div><span>来源依据</span><strong>{item.evidence.length ? `${item.evidence.length} 条已保留` : "继续观察"}</strong></div>
          {item.sources?.length ? <details className="edupi-insight-source">
            <summary>来源详情</summary>
            <div className="edupi-insight-source__items">{item.sources.map(source => <p key={source}>{source}</p>)}</div>
            {item.reviewTarget && onReviewTarget ? <button type="button" onClick={() => onReviewTarget(item.reviewTarget!)}>打开审核</button> : null}
            {item.reviewTargets?.map(target => onReviewTarget ? <button type="button" key={`${target.kind}:${target.id}`} onClick={() => onReviewTarget(target)}>打开原始观察审核</button> : null)}
          </details> : null}
          {item.sourceSessionId ? <a className="edupi-insight-source-link" href={`/?edupi=1&module=home&view=chat&inspector=0&session=${encodeURIComponent(item.sourceSessionId)}`}>打开来源对话</a> : null}
          {item.sourceText ? <blockquote className="edupi-insight-source-quote">{item.sourceText}</blockquote> : null}
        </div>
      </details>)}
      {studentObservations.loading ? <div role="status">读取中…</div> : visible.length === 0 && !studentObservations.error ? <div className="edupi-database__empty">{emptyMessage}</div> : null}
    </section>
    <nav className="edupi-database-pagination" aria-label="观察与洞察分页"><button type="button" disabled={currentPage === 0 || studentObservations.loading} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage >= pages - 1 || studentObservations.loading} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>
  </main>;
}
