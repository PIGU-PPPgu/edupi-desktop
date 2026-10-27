"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategoryRoute, materialItemRoute, materialObjectId } from "@/lib/edupi-domain-navigation";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { buildMaterialRows, defaultMaterialIntakeMetadata, type MaterialIntakeMetadata, type MaterialRow } from "@/lib/edupi-material-rows";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { EduPiMaterialExcerpt } from "./EduPiMaterialExcerpt";
import { intakeOperationHistory } from "@/lib/edupi-operation-history";
import { EduPiOperationHistory } from "./EduPiOperationHistory";
import { EduPiMaterialMetadataEditor } from "./EduPiMaterialMetadataEditor";
import { EduPiIconButton, EduPiPagination } from "./EduPiActionIcon";
import { hasUnboundSameNameClass, materialClassOptions } from "@/lib/edupi-material-class-options";
import { materialScheduleUploadProposal } from "@/lib/edupi-material-schedule";
import type { EduPiMaterialLessonProposal as UploadLessonProposal, EduPiMaterialScheduleProposal as UploadScheduleProposal } from "@/lib/edupi-core-process-client";
import { EduPiMaterialScheduleProposal } from "./EduPiMaterialScheduleProposal";
import { currentDocxChapter } from "@/lib/edupi-docx-chapter-suggestion";

const PAGE_SIZE = 8;
function isDocxMaterial(item: MaterialStagingDescriptor): boolean {
  return item.kind === "word" && item.staging_path.toLowerCase().endsWith(".docx");
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const LESSON_REASON_LABELS: Record<string, string> = {
  lesson_scope_required: "班级或学科待核对",
  lesson_date_required: "授课日期待核对",
  lesson_date_unlabeled: "授课日期待核对",
  lesson_date_ambiguous: "授课日期不唯一",
  lesson_date_invalid: "授课日期待核对",
  lesson_document_unresolved: "材料内容待核对",
  lesson_ambiguous: "课次不唯一",
  lesson_elapsed: "课次已过",
  lesson_calendar_unresolved: "校历待核对",
  lesson_permission_unavailable: "备课权限待核对",
};

function lessonProposalForDisplay(value: unknown, materialId: string, sourceHash: string): UploadLessonProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid lesson proposal");
  const proposal = value as UploadLessonProposal;
  if (proposal.material_id !== materialId || proposal.read_only !== true || proposal.automatic_prepare !== false
    || proposal.external_send !== false || !["proposed", "held", "unavailable"].includes(proposal.status)) throw new Error("invalid lesson proposal");
  if (proposal.status === "proposed" && (proposal.source_hash !== sourceHash || !proposal.lesson?.slot_id
    || !proposal.lesson.task_id || !/^\d{4}-\d{2}-\d{2}$/.test(proposal.lesson_date)
    || !Number.isFinite(Date.parse(proposal.lesson.starts_at)) || !Number.isSafeInteger(proposal.metadata_revision))) {
    throw new Error("invalid lesson proposal");
  }
  return proposal;
}

export function EduPiReceivedLessonProposal({ title, proposal, data, onTask, onChapterReview }: {
  title: string; proposal: UploadLessonProposal; data: Pick<EducationContract, "teacherMaterials" | "tasks">;
  onTask: (task: TeacherTask) => void;
  onChapterReview?: (materialId: string) => void;
}) {
  const material = data.teacherMaterials?.find(item => item.material_id === proposal.material_id);
  const sameMaterialRevision = proposal.status === "proposed" && material?.available !== false
    && material?.metadata_revision === proposal.metadata_revision;
  const task = sameMaterialRevision ? data.tasks.find(item => item.id === proposal.lesson.task_id) : null;
  return <details className="edupi-material-inbox">
    <summary>备课建议 <span>{sameMaterialRevision ? "待核对" : proposal.status === "proposed" ? "已失效" : "待核对"}</span></summary>
    <div className="edupi-material-pairing__current">
      <strong>{title}</strong>
      {sameMaterialRevision ? <><p>{proposal.lesson_date} · {material?.subject} · {material?.class_id}</p>
        {task ? <button type="button" onClick={() => onTask(task)}>查看课次任务</button> : null}
        {onChapterReview && currentDocxChapter(proposal, material.material_id, material.metadata_revision, material.available !== false)
          ? <button type="button" onClick={() => onChapterReview(material.material_id)}>用于备课</button> : null}
        <small>未启动备课</small></>
        : <p>{proposal.status === "proposed" ? "材料、课表或课次已变化，请重新核对。"
          : LESSON_REASON_LABELS[proposal.reason_code] || "材料或课表待核对"}</p>}
    </div>
  </details>;
}


export function EduPiMaterialsWorkspace({ data, context, query, selectedObjectId, onObject, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial, onOpenFile, onStartAgent, onEducation, onDeleteEntity }: { data: EducationContract; context: TeacherContextSnapshot | null; query: string; selectedObjectId: string | null; onObject: (id: string) => void; stagedMaterials: MaterialStagingDescriptor[]; stagingBusy: boolean; stagingMessage: { text: string; tone: "success" | "error" } | null; onTask: (task: TeacherTask) => void; onUpload: () => void; onIntakeMaterial: (item: MaterialStagingDescriptor, metadata: MaterialIntakeMetadata) => Promise<unknown>; onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>; onOpenFile: (path: string) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onEducation: (data: EducationContract) => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean> }) {
  const category = materialCategoryRoute(selectedObjectId);
  const focusedMaterialId = materialItemRoute(selectedObjectId);
  const categoryLabel = MATERIAL_CATEGORIES.find((item) => item.id === category)?.label || "全部材料";
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const closeSelected = useCallback(() => {
    setSelected(null);
    onObject(materialObjectId(category));
  }, [category, onObject]);
  const openSelected = useCallback((item: MaterialRow) => {
    setSelected(item);
    onObject(materialObjectId(category, item.id));
  }, [category, onObject]);
  const drawerRef = useModalDismiss<HTMLElement>(closeSelected, Boolean(selected));
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFocusGeneration, setDeleteFocusGeneration] = useState(0);
  const deleteFocusRef = useRef<{ materialId: string; scope: HTMLElement; trigger: HTMLButtonElement; from: Element | null } | null>(null);
  useEffect(() => {
    const request = deleteFocusRef.current;
    if (!request) return;
    if (request.materialId !== selected?.id || !request.scope.isConnected) { deleteFocusRef.current = null; return; }
    const document = request.scope.ownerDocument;
    if (deleteBusy) {
      const preserveMovedFocus = (event: FocusEvent) => {
        if (event.target === request.from || event.target === document.body || event.target === document.documentElement
          || (event.target as Element | null)?.closest?.(".edupi-delete-confirmation")) return;
        deleteFocusRef.current = null;
      };
      document.addEventListener("focusin", preserveMovedFocus);
      return () => document.removeEventListener("focusin", preserveMovedFocus);
    }
    deleteFocusRef.current = null;
    const active = document.activeElement;
    if (active !== request.from && active !== document.body && active !== document.documentElement) return;
    if (request.trigger.isConnected && !request.trigger.disabled && request.scope.contains(request.trigger)) request.trigger.focus({ preventScroll: false });
  }, [deleteBusy, deleteFocusGeneration, selected?.id]);
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");
  const [intakeDraft, setIntakeDraft] = useState<(MaterialIntakeMetadata & { stagingId: string }) | null>(null);
  const [receivedProposals, setReceivedProposals] = useState<Record<string, { title: string; proposal: UploadScheduleProposal }>>({});
  const [receivedLessonProposals, setReceivedLessonProposals] = useState<Record<string, { title: string; proposal: UploadLessonProposal }>>({});
  const classOptions = useMemo(() => materialClassOptions(data.timetable, context?.classes || []), [context?.classes, data.timetable]);
  const classes = useMemo(() => classOptions.map(option => option.value), [classOptions]);
  const unboundSameNameClass = useMemo(() => hasUnboundSameNameClass(data.timetable), [data.timetable]);
  const generatedError = data.generatedArtifactsUnavailable;
  const materialIntakeReady = data.capabilities.materialIntake.enabled;
  const allRows = useMemo(() => buildMaterialRows(data, query), [data, query]);
  const selectedMaterial = data.teacherMaterials?.find(item => item.material_id === selected?.id);
  const rows = useMemo(() => allRows.filter(item => category === "all" || item.category === category), [allRows, category]);
  useEffect(() => { setPage(0); }, [category, query]);
  useEffect(() => {
    if (!focusedMaterialId) { setSelected(null); return; }
    const index = rows.findIndex((item) => item.id === focusedMaterialId);
    if (index < 0) { closeSelected(); return; }
    setPage(Math.floor(index / PAGE_SIZE));
    setSelected(rows[index]);
  }, [closeSelected, focusedMaterialId, rows]);
  useEffect(() => {
    if (!selected) return;
    const current = allRows.find((item) => item.id === selected.id);
    if (!current) closeSelected();
    else if (current !== selected) setSelected(current);
  }, [allRows, closeSelected, selected]);
  useEffect(() => {
    if (intakeDraft && !stagedMaterials.some(item => item.staging_id === intakeDraft.stagingId)) setIntakeDraft(null);
  }, [intakeDraft, stagedMaterials]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pages - 1));
  useEffect(() => { setPage((value) => Math.max(0, Math.min(value, pages - 1))); }, [pages]);
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const materialSource = data.dataSources.materials;
  const materialSourceAvailable = materialSource.present || stagedMaterials.length > 0 || buildMaterialRows(data, "").length > 0;
  const openMaterialAgent = () => {
    if (!selected) return;
    const prompt = [
      `材料：${selected.title}`,
      `当前说明：${selected.summary}`,
      `来源：${selected.source}`,
    ].join("\n");
    onStartAgent(prompt, "replace");
  };
  const deleteSelected = async () => {
    if (!selected?.deleteKind || deleteBusy) return;
    const scope = drawerRef.current;
    const trigger = scope?.querySelector<HTMLButtonElement>("[data-material-delete-trigger]");
    const active = scope?.ownerDocument.activeElement || null;
    deleteFocusRef.current = scope && trigger && (scope.contains(active) || active === scope.ownerDocument.body || active === scope.ownerDocument.documentElement)
      ? { materialId: selected.id, scope, trigger, from: active } : null;
    setDeleteBusy(true);
    setOperationError("");
    try {
      if (selected.deleteKind === "generated") {
      const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", artifactId: selected.id }) });
      if (!response.ok) throw new Error("移除失败");
        deleteFocusRef.current = null; setArchivedId(selected.id); closeSelected();
        window.dispatchEvent(new Event("edupi-artifacts-updated"));
        return;
      }
      const deleted = selected.deleteKind === "task" && selected.task?.id
        ? await onDeleteEntity("task", selected.task.id, selected.title)
        : await onDeleteEntity("material", selected.id, selected.title);
      if (deleted) { deleteFocusRef.current = null; closeSelected(); }
    } catch {
      setOperationError("材料操作失败，请重试");
    } finally {
      setDeleteBusy(false);
      setDeleteFocusGeneration(value => value + 1);
    }
  };
  const openNative = async (mode: "open" | "reveal") => {
    if (!selected?.filePath) return;
    const desktop = await import("@/lib/desktop-native");
    if (mode === "open") await desktop.openPathNative(selected.filePath);
    else await desktop.revealItemInDirNative(selected.filePath);
  };
  const canDeleteSelected = selected?.deleteKind === "generated" || Boolean(selected?.deleteKind && data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes(selected.deleteKind) && (selected.deleteKind !== "task" || selected.task?.id));
  const selectedHistory = selected?.deleteKind === "material" ? intakeOperationHistory(data, "intake_material", selected.id) : [];
  const beginIntake = (item: MaterialStagingDescriptor) => {
    setOperationError("");
    const defaults = defaultMaterialIntakeMetadata(item.original_name, context);
    setIntakeDraft({ stagingId: item.staging_id, ...defaults,
      classId: classOptions.some(option => option.value === defaults.classId) ? defaults.classId : "" });
  };
  const submitIntake = async (item: MaterialStagingDescriptor) => {
    if (!intakeDraft || intakeDraft.stagingId !== item.staging_id
      || !intakeDraft.title.trim() || item.kind !== "calendar" && (!intakeDraft.subject.trim() || !intakeDraft.classId.trim())) {
      setOperationError("请填写材料名称、学科和班级");
      return;
    }
    setOperationError("");
    try {
      const received = await onIntakeMaterial(item, { title: intakeDraft.title.trim(), materialKind: intakeDraft.materialKind,
        subject: intakeDraft.subject.trim(), classId: intakeDraft.classId.trim() });
      if ((item.kind === "calendar" || isDocxMaterial(item)) && received && typeof received === "object" && "materialScheduleProposal" in received && received.materialScheduleProposal) {
        try {
          const proposal = materialScheduleUploadProposal(received.materialScheduleProposal);
          setReceivedProposals(current => ({ ...current, [proposal.material_id]: { title: item.original_name, proposal } }));
        } catch { setOperationError("安排提案未确认，请重新读取"); }
      }
      if (isDocxMaterial(item) && received && typeof received === "object"
        && "materialLessonProposal" in received && received.materialLessonProposal) {
        try {
          const proposal = lessonProposalForDisplay(received.materialLessonProposal,
            `material-${item.staging_id.slice("stg_".length)}`, item.source_hash);
          setReceivedLessonProposals(current => ({ ...current, [proposal.material_id]: { title: item.original_name, proposal } }));
        } catch { setOperationError("备课建议未确认，请核对材料"); }
      }
      setIntakeDraft(null);
    } catch { /* Parent surface reports the bounded intake error; staging remains. */ }
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><h1>{categoryLabel}</h1><p>{rows.length} 份材料{stagedMaterials.length > 0 ? ` · ${stagedMaterials.length} 份待接入` : ""}</p></div><button type="button" className="is-primary" disabled={stagingBusy} onClick={onUpload}>{stagingBusy ? "处理中…" : "上传材料"}</button></header>
    {stagedMaterials.length > 0 ? <details className="edupi-material-inbox" open>
      <summary>待接入材料 <span>{stagedMaterials.length}</span></summary>
      <div>{stagedMaterials.map((item) => {
        const calendar = item.kind === "calendar";
        const proposalSupported = calendar || isDocxMaterial(item);
        const itemReady = materialIntakeReady;
        return <div className="edupi-material-inbox__item" key={item.staging_id}>
          <div className="edupi-material-inbox__row">
            <strong>{item.original_name}</strong><span>{Math.ceil(item.expected_size_bytes / 1024)} KB</span>
            <button type="button" disabled={stagingBusy || !itemReady} title={!itemReady ? data.capabilities.materialIntake.reason : undefined} onClick={() => {
              if (intakeDraft?.stagingId === item.staging_id) {
                setIntakeDraft(null);
              } else beginIntake(item);
            }}>{intakeDraft?.stagingId === item.staging_id ? "取消" : "接入 EduPi"}</button>
            <button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button>
          </div>
          {intakeDraft?.stagingId === item.staging_id ? <form className="edupi-material-intake-form" onSubmit={event => { event.preventDefault(); void submitIntake(item); }}>
            <label>材料名称<input required maxLength={240} value={intakeDraft.title} onChange={event => setIntakeDraft({ ...intakeDraft, title: event.target.value })} /></label>
            {!calendar ? <>
              <label>材料类型<select value={intakeDraft.materialKind} onChange={event => setIntakeDraft({ ...intakeDraft, materialKind: event.target.value as MaterialIntakeMetadata["materialKind"] })}><option value="worksheet">学案 / 练习</option><option value="lesson_note">教案 / 备课</option><option value="assessment">测验 / 作业</option><option value="classroom_record">课堂记录</option><option value="other">其他</option></select></label>
              <label>学科<input required maxLength={120} value={intakeDraft.subject} onChange={event => setIntakeDraft({ ...intakeDraft, subject: event.target.value })} /></label>
              <label>班级{classOptions.length ? <select required value={intakeDraft.classId} onChange={event => setIntakeDraft({ ...intakeDraft, classId: event.target.value })}><option value="">选择班级</option>{classOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <input required maxLength={160} value={intakeDraft.classId} onChange={event => setIntakeDraft({ ...intakeDraft, classId: event.target.value })} />}</label>
              {unboundSameNameClass ? <small>同名旧课表请先补班级编号</small> : null}
            </> : null}
            <p role="status">{proposalSupported ? "旧安排更新、撤回和课表导入暂不可用。" : "仅接收材料，安排需手动核对。"}</p>
            <button type="submit" className="is-primary" disabled={stagingBusy}>接收材料</button>
          </form> : null}
        </div>;
      })}</div>
      {!materialIntakeReady && stagedMaterials.some((item) => item.kind !== "calendar") ? <p className="edupi-material-capability-note" role="status">{data.capabilities.materialIntake.reason}</p> : null}
    </details> : null}
    {stagingMessage ? <p className={`edupi-material-message${stagingMessage.tone === "error" ? " is-error" : ""}`} role={stagingMessage.tone === "error" ? "alert" : "status"}>{stagingMessage.text}</p> : null}
    {Object.values(receivedProposals).map(({ title, proposal }) => <section className="edupi-material-message" key={proposal.material_id} aria-label={`${title}安排提案`}>
      <strong>{title}</strong><EduPiMaterialScheduleProposal materialId={proposal.material_id} initialProposal={proposal}
        onApplied={() => window.dispatchEvent(new Event("edupi-education-refresh"))}/>
    </section>)}
    {Object.values(receivedLessonProposals).map(({ title, proposal }) => <EduPiReceivedLessonProposal key={`lesson:${proposal.material_id}`}
      title={title} proposal={proposal} data={data} onTask={onTask}
      onChapterReview={materialId => onObject(materialObjectId("all", materialId))} />)}
    {generatedError ? <p className="edupi-page-error" role="status">对话生成文件索引暂不可用</p> : null}
    {operationError ? <p role="alert">{operationError}</p> : null}
    {archivedId ? <p role="status">已移出材料，原文件保留。<button className="native-button" onClick={async () => { const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", artifactId: archivedId }) }); if (response.ok) { setArchivedId(null); window.dispatchEvent(new Event("edupi-artifacts-updated")); } }}>撤销</button></p> : null}
    <section className={`edupi-database${visible.length === 0 ? " is-empty" : ""}`} aria-label="材料列表" tabIndex={visible.length > 0 ? 0 : undefined}>{visible.length > 0 ? <div className="edupi-database__head edupi-material-db-grid"><span>材料</span><span>类型</span><span>学科 / 班级</span><span>来源</span><span>日期</span><span>状态</span></div> : null}{visible.map((item) => <button type="button" className="edupi-database-button-row edupi-material-db-grid" key={item.id} onClick={() => openSelected(item)}><strong>{item.title}</strong><span>{item.type}</span><span>{item.subject}</span><span>{item.source}</span><time>{shortDate(item.date)}</time><span>{item.status}</span></button>)}{visible.length === 0 ? <div className="edupi-database__empty">{materialSourceAvailable ? query.trim() ? "未找到匹配材料" : "当前分类暂无材料" : "材料索引尚未接入"}</div> : null}</section>
    {pages > 1 ? <EduPiPagination label="材料分页" page={currentPage} pages={pages} previousDisabled={currentPage === 0} nextDisabled={currentPage >= pages - 1} onPrevious={() => setPage(Math.max(0, currentPage - 1))} onNext={() => setPage(Math.min(pages - 1, currentPage + 1))}/> : null}
    {selected ? <aside ref={drawerRef} className="edupi-material-drawer" role="dialog" aria-modal="true" aria-label={`${selected.title}材料详情`}><header><div><span>{selected.type}</span><h2>{selected.title}</h2></div><EduPiIconButton type="button" icon="close" label="关闭材料详情" data-autofocus onClick={closeSelected}/></header><div className="edupi-material-drawer__body"><dl className="edupi-material-drawer__facts"><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>学科 / 班级</dt><dd>{selected.subject}</dd></div><div><dt>日期</dt><dd>{shortDate(selected.date)}</dd></div><div><dt>说明</dt><dd>{selected.summary}</dd></div></dl><EduPiOperationHistory rows={selectedHistory} />{selected.material ? <EduPiMaterialMetadataEditor material={selected.material} classes={classes} onEducation={onEducation} onStartAgent={onStartAgent} /> : null}{selected.deleteKind === "material" ? <EduPiMaterialExcerpt key={selected.id} materialId={selected.id} canSelectDocx={Boolean(selected.filePath?.toLowerCase().endsWith(".docx"))} metadataRevision={selectedMaterial?.metadata_revision} available={Boolean(selectedMaterial && selectedMaterial.available !== false)} chapterProposal={receivedLessonProposals[selected.id]?.proposal} onPreview={selected.filePath ? () => onOpenFile(selected.filePath!) : undefined} /> : null}{selected.material ? <EduPiMaterialScheduleProposal key={`schedule:${selected.id}`} materialId={selected.id} metadataRevision={selected.material.metadata_revision} onPreview={selected.filePath ? () => onOpenFile(selected.filePath!) : undefined} onApplied={() => window.dispatchEvent(new Event("edupi-education-refresh"))}/> : null}</div><footer>{selected.filePath ? <EduPiIconButton type="button" icon="preview" label="预览材料" onClick={() => onOpenFile(selected.filePath!)}/> : null}{selected.filePath && isTauriDesktop() ? <><EduPiIconButton type="button" icon="open" label="打开文件" onClick={() => void openNative("open")}/><EduPiIconButton type="button" icon="reveal" label="显示所在文件夹" onClick={() => void openNative("reveal")}/></> : null}{selected.task ? <EduPiIconButton type="button" icon="task" label="打开关联任务" onClick={() => onTask(selected.task!)}/> : null}{canDeleteSelected ? <EduPiIconButton type="button" icon="delete" data-material-delete-trigger label={deleteBusy ? "正在删除材料" : "删除材料"} className="is-delete" busy={deleteBusy} disabled={deleteBusy} onClick={() => void deleteSelected()}/> : null}{!selected.material ? <EduPiIconButton type="button" icon="agent" label="补充或修订材料" className="is-primary" onClick={openMaterialAgent}/> : null}</footer></aside> : null}
  </main>;
}
