"use client";


import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { EducationContract, EducationEntityDeleteKind, FamilyContact, TeacherTask } from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { studentRecordKey, studentRecordName } from "@/lib/edupi-student-roster-model";
import { parseStudentProfileList } from "@/lib/edupi-student-profile-edit";
import { buildStudentProfileConversationPrompt } from "@/lib/edupi-student-profile-prompt";
import { isUserFacingMemory, taskDisplayTitle, taskKey, taskStatusLabel } from "@/lib/edupi-workbench";
import { EduPiRosterPreview, type RosterPreview } from "./EduPiRosterPreview";
import { EduPiStudentEvents } from "./EduPiStudentEvents";
import { EduPiStudentFacts } from "./EduPiStudentFacts";
import { DisclosureChevron } from "./DisclosureChevron";
import { EduPiFamilyRecords } from "./EduPiFamilyRecords";
import { EduPiStudentMemoryActions } from "./EduPiStudentMemoryActions";
import { studentDirectoryPage } from "@/lib/edupi-student-pagination";
import type {
  StudentProfileVersion,
  StudentProfileVersionHistory,
  StudentProfileVersionSide,
  StudentProfileVersionValues,
} from "@/lib/edupi-student-profile-versions";
import { studentSemesterRange } from "@/lib/edupi-student-semester";
import { EduPiIconButton, EduPiPagination } from "./EduPiActionIcon";
import { EduPiClassDossier } from "./EduPiClassDossier";
import { dossierDate, UNASSIGNED_CLASS_FILTER } from "@/lib/edupi-class-dossier";
import { DossierCoverageCard, DossierTrendCard, DossierMiniActivity } from "./EduPiDossierCharts";
import { EduPiDossierRecordTable, type DossierRecordRow } from "./EduPiDossierRecordTable";

type Props = {
  mode: "homeroom" | "students";
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  query: string;
  selectedStudentId: string | null;
  onStudent: (student: Record<string, unknown> | null) => void;
  onEducation: (data: EducationContract) => void;
  onTask: (task: TeacherTask) => void;
  onStartAgent: (prompt: string, mode?: "insert" | "replace") => void;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
};

type StudentProfileEditor = {
  studentKey: string;
  className: string;
  traits: string;
  parentNotes: string;
  expectedUpdatedAt: string;
  expectedRevision: number;
};

const STUDENT_PROFILE_FIELD_LABELS = { class_name: "班级", traits: "学生特征", parent_notes: "家校备注" } as const;
const STUDENT_PROFILE_SOURCE_LABELS = { roster_import: "名单导入", teacher_edit: "手动修改", agent_update: "AI 协作", restore: "版本恢复" } as const;

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function shortDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "日期待补";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function csvCell(value: unknown): string {
  const source = String(value ?? "");
  const safe = /^\s*[=+\-@]/.test(source) ? `'${source}` : source;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(exportValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !/(?:^id$|_id$|_ids$|hash|path)/i.test(key)).map(([key, child]) => [key, exportValue(child)]));
}

function profileListLabel(value: string[]): string {
  return value.join("、") || "未设置";
}

function sameStudentProfileValues(left: StudentProfileVersionValues, right: StudentProfileVersionValues): boolean {
  return left.className === right.className
    && left.traits.length === right.traits.length && left.traits.every((value, index) => value === right.traits[index])
    && left.parentNotes.length === right.parentNotes.length && left.parentNotes.every((value, index) => value === right.parentNotes[index]);
}

function StudentFamilyRecords({ notes, contacts }: { notes: string[]; contacts: FamilyContact[] }) {
  return <details className="edupi-student-family-records" open={notes.length + contacts.length > 0}>
    <summary tabIndex={0}>家校记录{notes.length + contacts.length > 0 ? <span>{notes.length + contacts.length}</span> : null}</summary>
    <div>
      {notes.map((note, index) => <p key={`note:${index}`}>{note}</p>)}
      {contacts.map((contact) => <article key={contact.id}>
        <header><strong>{contact.name === contact.id ? "联系人" : contact.name}</strong><time>{contact.lastContactAt ? shortDate(contact.lastContactAt) : "日期未记录"}</time></header>
        <div className="edupi-student-family-records__identity"><span>{contact.relationship ? `记录称谓：${contact.relationship}` : "称谓未记录"}</span><span>监护身份待核实</span></div>
        {contact.lastTopic ? <p>{contact.lastTopic}</p> : null}
        {contact.lastOutcome ? <p>{contact.lastOutcome}</p> : null}
        <details><summary tabIndex={0}>记录详情</summary><dl><dt>记录来源</dt><dd>家校联系记录</dd><dt>原始来源</dt><dd>当前记录未提供</dd>{contact.concerns.length ? <><dt>关注事项</dt><dd>{contact.concerns.join("、")}</dd></> : null}{contact.communicationStyle.length ? <><dt>沟通备注</dt><dd>{contact.communicationStyle.join("、")}</dd></> : null}{contact.historyCount > 0 ? <><dt>联系记录</dt><dd>{contact.historyCount} 次</dd></> : null}</dl></details>
      </article>)}
      {notes.length + contacts.length === 0 ? <em>暂无家校记录</em> : null}
    </div>
  </details>;
}

function StudentProfileHistory({
  open,
  count,
  history,
  loading,
  error,
  current,
  busy,
  restoring,
  onToggle,
  onRestore,
}: {
  open: boolean;
  count: number;
  history: StudentProfileVersionHistory | null;
  loading: boolean;
  error: string | null;
  current: StudentProfileVersionValues;
  busy: boolean;
  restoring: string | null;
  onToggle: (open: boolean) => void;
  onRestore: (version: StudentProfileVersion, side: StudentProfileVersionSide) => void;
}) {
  const historyCount = history?.profileHistoryCount ?? count;
  return <details className="edupi-student-profile-history" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary>档案历史{historyCount > 0 ? <span>{historyCount}</span> : null}</summary>
    <div>
      {loading ? <p className="edupi-student-profile-history__state">正在读取…</p> : error ? <p className="edupi-student-profile-history__state is-error" role="alert">{error}</p> : history && history.versions.length > 0 ? <>
        <p className="edupi-student-profile-history__notice">恢复会同时替换班级、学生特征和家校备注。</p>
        <ol>{history.versions.slice().reverse().map((version) => <li key={version.versionId}>
          <header><div><strong>版本 {version.revision}</strong><span>{STUDENT_PROFILE_SOURCE_LABELS[version.sourceKind]}</span></div><time>{new Date(version.changedAt).toLocaleString("zh-CN")}</time></header>
          <small>修改了 {version.changedFields.map((field) => STUDENT_PROFILE_FIELD_LABELS[field]).join("、")}</small>
          <div className="edupi-student-profile-history__sides">{(["before", "after"] as const).map((side) => {
            const sideValues = side === "before" ? version.beforeValues : version.afterValues;
            const sideLabel = side === "before" ? "修改前" : "修改后";
            const isCurrent = sameStudentProfileValues(current, sideValues);
            const restoreKey = `${version.versionId}:${side}`;
            return <section key={side}>
              <header><strong>{sideLabel}</strong>{isCurrent ? <span>当前档案</span> : <button type="button" disabled={busy} onClick={() => onRestore(version, side)}>{restoring === restoreKey ? "恢复中…" : `恢复${sideLabel}`}</button>}</header>
              <dl><div><dt>班级</dt><dd title={sideValues.className || "未设置"}>{sideValues.className || "未设置"}</dd></div><div><dt>学生特征</dt><dd title={profileListLabel(sideValues.traits)}>{profileListLabel(sideValues.traits)}</dd></div><div><dt>家校备注</dt><dd title={profileListLabel(sideValues.parentNotes)}>{profileListLabel(sideValues.parentNotes)}</dd></div></dl>
            </section>;
          })}</div>
        </li>)}</ol>
      </> : <p className="edupi-student-profile-history__state">暂无档案历史</p>}
    </div>
  </details>;
}

export function EduPiStudentWorkspace({ mode, data, context, query, selectedStudentId, onStudent, onEducation, onTask, onStartAgent, onDeleteEntity }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const profileFormRef = useRef<HTMLFormElement>(null);
  const profileScrollRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileFocusRef = useRef<{ studentKey: string; target: "editor" | "trigger"; from: Element | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const rosterImportInFlightRef = useRef(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editor, setEditor] = useState<StudentProfileEditor | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [classSection, setClassSection] = useState<"overview" | "students">(query ? "students" : "overview");
  const [studentSection, setStudentSection] = useState<"overview" | "records" | "details">("overview");
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const directoryScrollRef = useRef(0);
  const directoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const directoryTriggerKeyRef = useRef<string | null>(null);
  const [profileHistoryOpen, setProfileHistoryOpen] = useState(false);
  const [profileHistory, setProfileHistory] = useState<{ studentId: string; value: StudentProfileVersionHistory } | null>(null);
  const [profileHistoryLoading, setProfileHistoryLoading] = useState(false);
  const [profileHistoryError, setProfileHistoryError] = useState<string | null>(null);
  const [restoringProfile, setRestoringProfile] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const alignedStudentIdRef = useRef<string | null>(null);
  const filterKey = JSON.stringify([classFilter, query]);
  const [pagination, setPagination] = useState({ filterKey, page: 0 });
  if (pagination.filterKey !== filterKey) setPagination({ filterKey, page: 0 });
  const directory = studentDirectoryPage(data.students, classFilter, query, pagination.filterKey === filterKey ? pagination.page : 0);
  if (pagination.filterKey === filterKey && pagination.page !== directory.page) setPagination({ filterKey, page: directory.page });
  const classNames = [...new Set(data.students.map(student => String(student.class_name || "").trim()).filter(Boolean))].sort();
  const students = directory.filtered.map(row => row.student);
  const selected = data.students.find((student, index) => studentRecordKey(student, index) === selectedStudentId) || null;
  const selectedClassName = selected && typeof selected.class_name === "string" ? selected.class_name.trim() : "";
  const selectedName = useMemo(() => selected ? studentRecordName(selected) : null, [selected]);
  const uniqueSelectedName = Boolean(selectedName && (data.studentNameCounts ? data.studentNameCounts[selectedName] === 1 : data.students.filter(student => studentRecordName(student) === selectedName).length === 1));
  const patterns = selected ? records(selected.error_patterns) : [];
  const trajectory = selected ? records(selected.trajectory) : [];
  const traits = selected && Array.isArray(selected.traits) ? selected.traits.filter((item): item is string => typeof item === "string") : [];
  const parentNotes = selected && Array.isArray(selected.parent_notes) ? selected.parent_notes.filter((item): item is string => typeof item === "string") : [];
  const selectedUpdatedAt = selected && typeof selected.updated_at === "string" ? selected.updated_at : null;
  const selectedProfileRevision = selected && Number.isInteger(selected.profile_revision) && Number(selected.profile_revision) >= 0 ? Number(selected.profile_revision) : 0;
  const selectedProfileHistoryCount = selected && Number.isInteger(selected.profile_history_count) && Number(selected.profile_history_count) >= 0 ? Number(selected.profile_history_count) : 0;
  const selectedProfileValues: StudentProfileVersionValues = { className: selected && typeof selected.class_name === "string" ? selected.class_name : null, traits, parentNotes };
  const visibleProfileHistory = profileHistory?.studentId === selectedStudentId ? profileHistory.value : null;
  const familyContacts = selectedName ? data.continuity.familyContacts.filter((contact) => contact.student === selectedStudentId || uniqueSelectedName && contact.student === selectedName) : [];
  const tasks = selectedName ? data.tasks.filter((task) => task.student === selectedStudentId || uniqueSelectedName && (task.student === selectedName || task.sourceEventName?.includes(selectedName))) : [];
  const memories = selectedName ? data.continuity.memories.filter((memory) => memory.state === "active" && isUserFacingMemory(memory) && (memory.student === selectedStudentId || uniqueSelectedName && (memory.student === selectedName || memory.content.includes(selectedName)))) : [];
  const currentSemesterRange = studentSemesterRange(data.calendar);
  const studentPageRef = useRef<HTMLElement>(null);
  const editingStudentKey = editor?.studentKey ?? null;
  useEffect(() => { if (query) setClassSection("students"); }, [query]);
  useEffect(() => {
    if (workspaceRef.current) workspaceRef.current.scrollTop = selectedStudentId ? 0 : directoryScrollRef.current;
    if (selectedStudentId && typeof document !== "undefined" && (document.activeElement === document.body || studentPageRef.current?.contains(document.activeElement) || document.activeElement === directoryTriggerRef.current)) detailHeadingRef.current?.focus({ preventScroll: true });
    else if (!selectedStudentId && directoryTriggerRef.current?.isConnected) directoryTriggerRef.current.focus({ preventScroll: true });
  }, [selectedStudentId]);

  useEffect(() => {
    const request = profileFocusRef.current;
    profileFocusRef.current = null;
    if (!request || request.studentKey !== selectedStudentId) return;
    if (request.target === "editor" ? editingStudentKey !== selectedStudentId : editingStudentKey !== null) return;
    if (document.activeElement !== request.from && document.activeElement !== document.body) return;
    const target = request.target === "editor" ? profileInputRef.current : profileTriggerRef.current;
    if (!target?.isConnected) return;
    if (request.target === "editor" && profileScrollRef.current) profileScrollRef.current.scrollTop = 0;
    target.focus({ preventScroll: true });
    if (request.target === "editor") target.scrollIntoView?.({ block: "nearest" });
  }, [editingStudentKey, selectedStudentId]);

  const fetchProfileHistory = useCallback(async (signal?: AbortSignal): Promise<StudentProfileVersionHistory> => {
    if (!selectedName || !selectedStudentId) throw new Error("学生身份无效");
    const response = await fetch(`/api/edupi/students/${encodeURIComponent(selectedName)}/versions?studentId=${encodeURIComponent(selectedStudentId)}`, { cache: "no-store", signal });
    const result = await response.json() as { history?: StudentProfileVersionHistory; error?: string };
    if (!response.ok || !result.history) throw new Error(result.error || "学生档案历史读取失败");
    return result.history;
  }, [selectedName, selectedStudentId]);

  useEffect(() => {
    if (!selectedStudentId) { alignedStudentIdRef.current = null; return; }
    if (!selected || alignedStudentIdRef.current === selectedStudentId) return;
    const selectedClass = String(selected.class_name || "").trim();
    if (classFilter && (classFilter === UNASSIGNED_CLASS_FILTER ? Boolean(selectedClass) : classFilter !== selectedClass)) {
      setClassFilter("");
      return;
    }
    const selectedIndex = directory.filtered.findIndex(({ student, key }) => key === selectedStudentId || student === selected);
    alignedStudentIdRef.current = selectedStudentId;
    if (selectedIndex < 0) return;
    const selectedPage = Math.floor(selectedIndex / 24);
    setPagination((current) => current.filterKey === filterKey && current.page === selectedPage ? current : { filterKey, page: selectedPage });
  }, [classFilter, directory.filtered, filterKey, selected, selectedStudentId]);

  useEffect(() => {
    setStudentSection("overview");
    setProfileHistoryOpen(false);
    setProfileHistory(null);
    setProfileHistoryError(null);
    setRestoringProfile(null);
  }, [selectedStudentId]);

  useEffect(() => {
    if (!profileHistoryOpen || !selectedStudentId) return;
    const controller = new AbortController();
    setProfileHistoryLoading(true);
    setProfileHistoryError(null);
    fetchProfileHistory(controller.signal)
      .then((value) => setProfileHistory({ studentId: value.studentId, value }))
      .catch((error) => { if (!controller.signal.aborted) setProfileHistoryError(error instanceof Error ? error.message : "学生档案历史读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setProfileHistoryLoading(false); });
    return () => controller.abort();
  }, [fetchProfileHistory, profileHistoryOpen, selectedProfileRevision, selectedStudentId]);

  useEffect(() => {
    if (!message) return;
    if (message.tone === "error") setLastError(message.text);
    const timer = window.setTimeout(() => setMessage(null), message.tone === "error" ? 8_000 : 4_000);
    return () => window.clearTimeout(timer);
  }, [message]);


  const importRosterFile = async (file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    const response = await fetch("/api/edupi/students/import?preview=1", { method: "POST", body });
    const result = await response.json() as RosterPreview & { error?: string };
    if (!response.ok || !result.sheets?.length) throw new Error(result.error || "名单预览失败。");
    setPreview(result);
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy || rosterImportInFlightRef.current) return;
    rosterImportInFlightRef.current = true;
    setPreview(null);
    setBusy(true); setMessage(null);
    try { await importRosterFile(file); }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生名单导入失败。" }); }
    finally { rosterImportInFlightRef.current = false; setBusy(false); }
  };
  const confirmImport = async (csv: string) => {
    if (!preview || busy || rosterImportInFlightRef.current) return;
    rosterImportInFlightRef.current = true;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/edupi/students/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceName: preview.sourceName, csv }) });
      const result = await response.json() as { error?: string; data?: EducationContract; result?: { imported?: number } };
      if (!response.ok || !result.data) throw new Error(result.error || "学生名单导入失败。");
      onEducation(result.data); setPreview(null);
      setMessage({ tone: "success", text: `已导入 ${result.result?.imported ?? 0} 名学生` });
    } catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "导入失败，请重试。" }); }
    finally { rosterImportInFlightRef.current = false; setBusy(false); }
  };
  const closeEditor = () => {
    const active = document.activeElement;
    profileFocusRef.current = editor && (profileFormRef.current?.contains(active) || active === document.body)
      ? { studentKey: editor.studentKey, target: "trigger", from: active }
      : null;
    setEditor(null);
  };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedName || !editor || editor.studentKey !== selectedStudentId || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/students/${encodeURIComponent(selectedName)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId:selectedStudentId, className:editor.className.trim() || null, traits: parseStudentProfileList(editor.traits), parentNotes: parseStudentProfileList(editor.parentNotes), expectedUpdatedAt: editor.expectedUpdatedAt, expectedRevision: editor.expectedRevision }) });
      const result = await response.json() as { error?: string; data?: EducationContract };
      if (!response.ok || !result.data) throw new Error(result.error || "学生档案修改失败。");
      onEducation(result.data);
      closeEditor();
      setMessage({ tone: "success", text: "学生档案已更新" });
    }
    catch (error) { setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生档案修改失败。" }); }
    finally { setBusy(false); }
  };
  const openEditor = (event: { currentTarget: HTMLButtonElement }) => {
    if (!selectedName || !selectedUpdatedAt || !selectedStudentId) return;
    profileTriggerRef.current = event.currentTarget;
    if (editingStudentKey === selectedStudentId) {
      if (profileScrollRef.current) profileScrollRef.current.scrollTop = 0;
      profileInputRef.current?.focus({ preventScroll: true });
      return;
    }
    profileFocusRef.current = { studentKey: selectedStudentId, target: "editor", from: document.activeElement };
    setMessage(null);
    setEditor({ studentKey: selectedStudentId, className:String(selected?.class_name || ""), traits: traits.join("\n"), parentNotes: parentNotes.join("\n"), expectedUpdatedAt: selectedUpdatedAt, expectedRevision: selectedProfileRevision });
  };
  const restoreProfile = async (version: StudentProfileVersion, versionSide: StudentProfileVersionSide) => {
    if (!selectedName || !selectedStudentId || busy) return;
    const restoreKey = `${version.versionId}:${versionSide}`;
    setBusy(true); setRestoringProfile(restoreKey); setMessage(null);
    try {
      const response = await fetch(`/api/edupi/students/${encodeURIComponent(selectedName)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, versionId: version.versionId, versionSide, expectedRevision: selectedProfileRevision }),
      });
      const result = await response.json() as { error?: string; data?: EducationContract; history?: StudentProfileVersionHistory };
      if (!response.ok || !result.data || !result.history) throw new Error(result.error || "学生档案恢复失败");
      onEducation(result.data);
      setProfileHistory({ studentId: result.history.studentId, value: result.history });
      setEditor(null);
      setMessage({ tone: "success", text: `已恢复版本 ${version.revision} 的${versionSide === "before" ? "修改前" : "修改后"}档案` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生档案恢复失败" });
    } finally {
      setBusy(false); setRestoringProfile(null);
    }
  };
  const openStudentAgent = () => {
    if (!selectedName) return;
    const prompt = buildStudentProfileConversationPrompt({ name: selectedName, studentId:selectedStudentId || undefined, className:String(selected?.class_name || ""), traits, parentNotes, patternCount: patterns.length, trajectoryCount: trajectory.length });
    onStartAgent(prompt, "replace");
  };
  const openStudentMemoryAgent = (content: string) => {
    if (!selectedName) return;
    const prompt = [
      `学生：${selectedName}`,
      `当前内容：${content}`,
    ].join("\n");
    onStartAgent(prompt, "replace");
  };
  const deleteStudent = async () => {
    if (!selectedName || busy) return;
    setBusy(true); setMessage(null);
    try {
      const label = [selectedName, selected?.class_name].filter(Boolean).join(" · ");
      const deleted = await onDeleteEntity("student", selectedStudentId || selectedName, label);
      if (!deleted) return;
      setEditor(null);
      onStudent(null);
      setMessage({ tone: "success", text: "学生档案已删除" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生档案删除失败。" });
    } finally {
      setBusy(false);
    }
  };
  const exportCurrent = () => download(`${JSON.stringify({ exported_at: new Date().toISOString(), students: exportValue(selected ? [selected] : data.students) }, null, 2)}\n`, selectedName ? `${selectedName}-学生档案.json` : "班级学生档案.json", "application/json;charset=utf-8");
  const exportTimeline = () => {
    if (!selectedName) return;
    const rows = trajectory.map((item) => [item.date || "", item.event || "", item.note || item.description || ""]);
    download(`\uFEFF${[["日期", "事件", "备注"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, `${selectedName}-成长记录.csv`, "text/csv;charset=utf-8");
  };

  const closeStudent = () => {
    setEditor(null);
    onStudent(null);
  };
  const openStudent = (student: Record<string, unknown>) => {
    setEditor(null);
    onStudent(student);
  };
  const classTitle = classFilter === UNASSIGNED_CLASS_FILTER ? "未分班" : classFilter || "全部班级";
  const showDirectory = mode === "students" || classSection === "students" || data.students.length === 0;
  const sortedTrajectory = trajectory.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = dossierDate(left.item.date)?.timestamp ?? -Infinity;
      const b = dossierDate(right.item.date)?.timestamp ?? -Infinity;
      return b - a || right.index - left.index;
    });

  const chartEntries = trajectory.map(item => ({ date: typeof item.date === "string" ? item.date : null, label: String(item.event || "成长记录") }));
  const resolvedPatterns = patterns.filter(item => item.status === "resolved").length;
  const dossierRows: DossierRecordRow[] = [
    ...trajectory.map((item,index) => ({ id: `growth:${index}`, title: String(item.event || "成长记录"), date: typeof item.date === "string" ? item.date : null, note: String(item.note || item.description || ""), kind: "growth" as const })),
    ...patterns.map((item,index) => ({ id: `pattern:${index}`, title: String(item.description || "学习问题"), date: typeof item.last_seen === "string" ? item.last_seen : null, note: String(item.note || ""), kind: item.status === "resolved" ? "resolved" as const : "attention" as const })),
  ];

  return <main ref={workspaceRef} onScroll={event => { if (!selected) directoryScrollRef.current = event.currentTarget.scrollTop; }} className={`edupi-module-workspace edupi-class-workspace edupi-dossier-workspace${selected ? " has-student-page" : ""}`}>
    <header className="edupi-module-heading edupi-student-heading">
      {selected ? <button type="button" className="edupi-dossier-back" onClick={closeStudent}>← <span>{mode === "homeroom" ? "返回班级" : "返回学生名册"}</span></button> : <h1>{mode === "homeroom" ? "班级" : "学生档案"}</h1>}
      <div className="edupi-student-heading__actions">
        {!selected && data.students.length > 0 ? <button type="button" className="is-primary" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "导入中…" : "导入名单"}</button> : null}
        <details className="edupi-dossier-export"><summary>导出</summary><div><button type="button" onClick={exportCurrent} disabled={data.students.length === 0}>{selected ? "导出当前档案" : "导出全部档案"}</button>{selected ? <button type="button" onClick={exportTimeline} disabled={trajectory.length === 0}>导出成长记录</button> : null}</div></details>
      </div>
      <input ref={inputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm,.xlsb,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={importFile} />
    </header>
    {message ? <p className={`edupi-student-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    {lastError ? <details className="edupi-student-message is-error"><summary>最近一次操作失败</summary><p>{lastError}</p><button type="button" onClick={() => setLastError(null)}>清除</button></details> : null}
    {preview ? <EduPiRosterPreview key={preview.sourceName} preview={preview} busy={busy} onCancel={() => setPreview(null)} onImport={(csv) => void confirmImport(csv)} /> : null}
    {!selected ? <>
      {mode === "homeroom" ? <nav className="edupi-dossier-tabs" aria-label="班级视图"><button type="button" aria-pressed={!showDirectory} onClick={() => setClassSection("overview")}>班级档案</button><button type="button" aria-pressed={showDirectory} onClick={() => setClassSection("students")}>学生名册</button></nav> : null}
      {!showDirectory ? <EduPiClassDossier data={data} context={context} classFilter={classFilter} onClass={setClassFilter} onStudent={openStudent} onAgent={onStartAgent} onShowStudents={() => setClassSection("students")} onShowRecords={() => { setClassSection("students"); setShowRecords(true); }} /> : <>
        <div className="edupi-directory-toolbar"><h2>{classTitle}</h2>{data.students.length > 0 ? <label className="edupi-student-class-filter">班级 <select value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="">全部班级</option>{classNames.map(name => <option key={name} value={name}>{name}</option>)}{data.students.some(student => typeof student.class_name !== "string" || !student.class_name.trim()) ? <option value={UNASSIGNED_CLASS_FILTER}>未分班</option> : null}</select></label> : null}</div>
        <div className="edupi-student-events-toggle"><button type="button" className="disclosure-trigger is-inline" aria-expanded={showRecords} onClick={() => setShowRecords(value => !value)}><span>{showRecords ? "收起学生记录" : "全部学生记录"}</span><DisclosureChevron open={showRecords} /></button></div>
        {showRecords ? <section aria-label="全部学生记录"><h3 className="edupi-all-records-label">全部学生记录</h3><EduPiStudentEvents key="all" student={null} semesterRange={currentSemesterRange} onAgent={onStartAgent} /></section> : null}
        <section className="edupi-student-directory edupi-student-directory--list" aria-label="学生名单">
          <header><h2>学生</h2>{students.length > 0 ? <span>{students.length} 名学生</span> : null}</header>
          {students.length > 0 ? <>
            <div className="edupi-student-directory__columns" aria-hidden="true"><span>姓名</span><span>班级</span><span>档案记录</span></div>
            <ul className="edupi-student-directory__rows">{directory.rows.map(({ student, key }) => {
              const name = studentRecordName(student);
              const className = typeof student.class_name === "string" ? student.class_name : "";
              const studentTraits = Array.isArray(student.traits) ? student.traits.filter((trait): trait is string => typeof trait === "string").join("、") : "";
              const problemCount = records(student.error_patterns).filter(item => item.status !== "resolved").length;
              const growthCount = records(student.trajectory).length;
              const recordLabel = [growthCount > 0 ? `${growthCount} 条成长记录` : "", problemCount > 0 ? `${problemCount} 条学习问题` : ""].filter(Boolean).join(" · ");
              return <li key={key}><button type="button" className="edupi-student-directory__row" ref={node => { if (directoryTriggerKeyRef.current === key) directoryTriggerRef.current = node; }} aria-label={[name, className, recordLabel].filter(Boolean).join("，")} onClick={event => { directoryTriggerRef.current = event.currentTarget; directoryTriggerKeyRef.current = key; openStudent(student); }}>
                <span className="edupi-student-directory__identity"><span className="edupi-student-directory__avatar" aria-hidden="true">{name.slice(0, 1)}</span><span><strong>{name}</strong>{className ? <small className="edupi-student-directory__mobile-class">{className}</small> : null}{studentTraits ? <small title={studentTraits}>{studentTraits}</small> : null}</span></span>
                <span className="edupi-student-directory__class">{className || "未分班"}</span>
                <span className="edupi-student-directory__records">{recordLabel || "暂无记录"}<span aria-hidden="true"> ↗</span></span>
              </button></li>;
            })}</ul>
          </> : data.students.length === 0 ? <button type="button" className="edupi-student-directory__empty" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "导入中…" : "导入学生名单"}</button> : <p className="edupi-student-directory__no-results edupi-student-directory__filtered-empty">当前筛选无学生</p>}
        </section>
        {directory.pages > 1 ? <EduPiPagination label="学生分页" page={directory.page} pages={directory.pages} previousDisabled={directory.page === 0} nextDisabled={directory.page === directory.pages - 1} onPrevious={() => setPagination({ filterKey, page: directory.page - 1 })} onNext={() => setPagination({ filterKey, page: directory.page + 1 })} /> : null}
      </>}
    </> : selectedName ? <section ref={studentPageRef} className="edupi-student-dossier" aria-label={`${selectedName}学生档案`}>
      <div className="edupi-student-dossier__content">
      <header className="edupi-student-dossier__heading"><div><h1 ref={detailHeadingRef} tabIndex={-1}>{selectedName}</h1></div><div className="edupi-student-dossier__actions"><button type="button" className="edupi-dossier-mobile-agent" aria-label="与当前学生协作" onClick={openStudentAgent}>AI 协作</button><EduPiIconButton type="button" icon="edit" label="手动修改" onClick={openEditor} disabled={!selectedUpdatedAt || busy} aria-expanded={editingStudentKey === selectedStudentId} aria-controls={editingStudentKey === selectedStudentId ? "edupi-student-profile-editor" : undefined}/>{data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes("student") ? <EduPiIconButton type="button" icon="delete" label={busy ? "正在删除学生档案" : "删除学生档案"} className="is-delete" busy={busy} disabled={busy} onClick={() => void deleteStudent()}/> : null}</div></header>
      <nav className="edupi-dossier-tabs" aria-label="学生档案视图"><button type="button" aria-pressed={studentSection === "overview"} onClick={() => setStudentSection("overview")}>档案概览</button><button type="button" aria-pressed={studentSection === "records"} onClick={() => setStudentSection("records")}>学习与互动</button><button type="button" aria-pressed={studentSection === "details"} onClick={() => setStudentSection("details")}>资料与历史</button></nav>
      <div ref={profileScrollRef} className="edupi-student-drawer__scroll">
        {editor?.studentKey === selectedStudentId ? <form ref={profileFormRef} id="edupi-student-profile-editor" className="edupi-student-profile-editor" onSubmit={saveProfile}><header><h2>修改档案</h2><button type="button" onClick={closeEditor} disabled={busy}>取消</button></header><label><span>班级</span><input ref={profileInputRef} value={editor.className} maxLength={120} onChange={event => setEditor({...editor,className:event.target.value})} /></label><label><span>学生特征</span><textarea value={editor.traits} maxLength={12000} rows={4} placeholder="每行一个特征" onChange={event => setEditor({ ...editor, traits: event.target.value })} /></label><label><span>家校备注</span><textarea value={editor.parentNotes} maxLength={12000} rows={5} placeholder="每行一条备注" onChange={event => setEditor({ ...editor,parentNotes:event.target.value })} /></label><button type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></form> : null}
        <div className="edupi-student-dossier__grid" hidden={studentSection === "records"}>
          <div className="edupi-student-dossier__body">
            <div className="edupi-dossier-dashboard" hidden={studentSection !== "overview"}>
              <div className="edupi-dossier-chart-pair"><DossierCoverageCard title="学习问题跟进" numerator={resolvedPatterns} denominator={patterns.length} numeratorLabel="已解决" remainderLabel="关注中" /><DossierTrendCard title="成长记录趋势" entries={chartEntries} /></div>
              <EduPiDossierRecordTable key={selectedStudentId} rows={dossierRows} />
            </div>
            <div className="edupi-dossier-details" hidden={studentSection !== "details"}>
            <section className="edupi-dossier-panel edupi-dossier-traits"><header><h2>学生特征</h2></header>{traits.length ? <ul>{traits.map((trait, index) => <li key={index}>{trait}</li>)}</ul> : <p className="edupi-dossier-empty">暂无特征记录</p>}</section>
            <section className="edupi-dossier-panel edupi-dossier-timeline"><header><h2>成长记录</h2>{trajectory.length ? <span>{trajectory.length} 条</span> : null}</header>{sortedTrajectory.length ? <ol>{sortedTrajectory.map(({item, index}) => <li key={index}><time>{shortDate(item.date)}</time><div><h3>{String(item.event || "成长记录")}</h3>{item.note || item.description ? <p>{String(item.note || item.description)}</p> : null}</div></li>)}</ol> : <p className="edupi-dossier-empty">暂无成长记录</p>}</section>
            <section className="edupi-dossier-panel edupi-dossier-patterns"><header><h2>学习问题</h2>{patterns.length ? <span>{patterns.length} 条</span> : null}</header>{patterns.length ? patterns.map((item, index) => <article key={index}><span className={`edupi-dossier-status${item.status === "resolved" ? " is-resolved" : ""}`}>{item.status === "resolved" ? "已解决" : "观察中"}</span><div><h3>{String(item.description || "学习问题")}</h3>{item.last_seen ? <time>{shortDate(item.last_seen)}</time> : null}</div></article>) : <p className="edupi-dossier-empty">暂无学习问题记录</p>}</section>
            {typeof selected.student_id === "string" ? <section className="edupi-dossier-panel edupi-dossier-facts"><EduPiStudentFacts factSpine={data.factSpine} studentId={selected.student_id} reviewer={context?.name || "teacher"} onEducation={onEducation} /></section> : null}
            <section className="edupi-dossier-panel edupi-dossier-history"><StudentProfileHistory open={profileHistoryOpen} count={selectedProfileHistoryCount} history={visibleProfileHistory} loading={profileHistoryLoading} error={profileHistoryError} current={selectedProfileValues} busy={busy} restoring={restoringProfile} onToggle={setProfileHistoryOpen} onRestore={(version, side) => void restoreProfile(version, side)} /></section>
            </div>
          </div>

          <section className="edupi-dossier-panel edupi-dossier-memories" hidden={studentSection !== "details"}><header><h2>相关记忆</h2>{memories.length ? <span>{memories.length} 条</span> : null}</header>{memories.length ? memories.map(memory => <article key={memory.id}><p>{memory.content}</p><EduPiStudentMemoryActions memory={memory} onEducation={onEducation} onAgent={() => openStudentMemoryAgent(memory.content)} onDelete={() => { void onDeleteEntity("memory", memory.id, memory.content).catch(() => {}); }} /></article>) : <p className="edupi-dossier-empty">暂无已关联记忆</p>}</section>
          {tasks.length ? <section className="edupi-dossier-panel edupi-dossier-tasks" hidden={studentSection !== "details"}><header><h2>相关任务</h2></header>{tasks.map(task => <button type="button" key={taskKey(task)} onClick={() => onTask(task)}><strong>{taskDisplayTitle(task)}</strong><span>{taskStatusLabel(task)}</span></button>)}</section> : null}
        </div>
        <section className="edupi-dossier-records" hidden={studentSection !== "records"} aria-label="学习与互动"><EduPiStudentEvents key={selectedStudentId} student={selectedName} studentId={typeof selected.student_id === "string" ? selected.student_id : undefined} studentClass={String(selected.class_name || "")} semesterRange={currentSemesterRange} onAgent={onStartAgent} familyRecords={typeof selected.student_id === "string" ? <EduPiFamilyRecords key={selected.student_id} studentId={selected.student_id} studentName={selectedName || "学生"} reviewer={context?.name || "teacher"} onEducation={onEducation} /> : undefined} /></section>

      </div>
      </div>
          <aside className="edupi-student-dossier__sidebar" aria-label="基本档案">
            <section className="edupi-dossier-identity"><h2>学生档案</h2><div className="edupi-dossier-portrait"><picture><source srcSet="/dossier/default-student-avatar.webp" type="image/webp" /><img src="/dossier/default-student-avatar.png" alt="" width="280" height="220" /></picture><small>默认形象</small></div><div className="edupi-dossier-identity__status"><span>{selectedClassName || "未分班"}</span><button type="button" onClick={openStudentAgent}>AI 协作</button></div><dl><div><dt>班级</dt><dd>{selectedClassName || "未分班"}</dd></div>{context?.grade ? <div><dt>年级</dt><dd>{context.grade}</dd></div> : null}{selectedUpdatedAt ? <div><dt>档案更新</dt><dd>{shortDate(selectedUpdatedAt)}</dd></div> : null}</dl></section>
            <DossierMiniActivity entries={chartEntries} />
            <section className="edupi-dossier-panel edupi-dossier-family"><StudentFamilyRecords notes={parentNotes} contacts={familyContacts} /></section>
          </aside>
    </section> : null}
  </main>;
}
