"use client";

import { useEffect, useId, useRef, useState } from "react";
import { readRecallSettings, updateRecallSettings, type RecallSettingsView } from "@/lib/edupi-recall-prompt-client";

type Model = { provider: string; modelId: string; name?: string };
const modelKey = (model: Model) => JSON.stringify([model.provider, model.modelId]);
const localDateTime = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export function CoreRecallSettings({ models = [], classes = [], active = true }: { models?: Model[]; classes?: Array<{ id: string; name: string }>; active?: boolean }) {
  const id = useId();
  const [view, setView] = useState<RecallSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [model, setModel] = useState("");
  const [limit, setLimit] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [refreshKey, setRefreshKey] = useState(0);
  const initialized = useRef(false);
  const busyRef = useRef(false);
  const readEpoch = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  useEffect(() => { if (active) setNow(Date.now()); }, [active]);
  useEffect(() => {
    if (!active || busy) return;
    const epoch = ++readEpoch.current;
    const controller = new AbortController();
    readAbort.current = controller;
    void readRecallSettings(controller.signal).then(value => {
      if (controller.signal.aborted || epoch !== readEpoch.current) return;
      setView(value);
      setError(current => current === "记忆核验设置暂不可用" ? "" : current);
      if (!initialized.current) {
        initialized.current = true;
        setClassId(value.config.scope?.classId ?? "");
        setSubject(value.config.scope?.subject ?? "");
        setModel(value.config.model ? modelKey(value.config.model) : "");
        setLimit(value.config.limit?.toString() ?? "");
        setValidUntil(localDateTime(value.config.validUntil));
      }
    }, () => { if (!controller.signal.aborted && epoch === readEpoch.current) setError("记忆核验设置暂不可用"); });
    return () => {
      controller.abort();
      if (readAbort.current === controller) readAbort.current = null;
    };
  }, [refreshKey, active, busy]);
  const availableModels = [...models];
  if (view?.config.model && !availableModels.some(item => modelKey(item) === modelKey(view.config.model!))) availableModels.push(view.config.model);
  const selected = availableModels.find(item => modelKey(item) === model);
  const until = Date.parse(validUntil), count = Number(limit);
  useEffect(() => {
    if (!active || !Number.isFinite(until) || until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(7 * 86_400_000, until - now + 1));
    return () => clearTimeout(timer);
  }, [until, now, active]);
  const valid = Boolean(classes.some(item => item.id === classId) && subject.trim() && selected && limit && Number.isInteger(count) && count >= 1 && count <= 12
    && until > now && until <= now + 7 * 86_400_000);
  const update = async (enabled: boolean) => {
    if (busyRef.current || !view || enabled && (!view.normalApproved || !valid || !selected)) return;
    busyRef.current = true;
    ++readEpoch.current; readAbort.current?.abort();
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await updateRecallSettings(enabled && selected ? {
        enabled: true, expectedUpdatedAt: view.config.updatedAt,
        scope: { classId: classId.trim(), subject: subject.trim() },
        model: { provider: selected.provider, modelId: selected.modelId }, limit: count, validUntil: new Date(until).toISOString(),
      } : { enabled: false, expectedUpdatedAt: view.config.updatedAt });
      setView(value);
      setNotice(enabled ? "已开启" : value.stop?.status === "unknown" || value.stop?.grants === "unknown"
        ? "已关闭，停止状态待核对" : value.stop?.status === "stopped" ? "已停止" : "停止结果待核对");
    } catch { setError(enabled ? "保存结果待核对，请刷新状态" : "停止结果待核对，请刷新状态"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <div className="edupi-settings-recall" aria-label="记忆核验">
    <div className="edupi-admin-list"><div><span role="status">
      {!view ? error ? "暂不可用" : "读取中" : !view.normalApproved ? "待验收" : view.activation.enabled ? "已开启" : "已关闭"}
    </span>{view?.config.limit !== null && view?.config.limit !== undefined
      ? <span>剩余 {view.config.remaining ?? "—"} / {view.config.limit} 次</span> : null}</div></div>
    <form onSubmit={event => {
      event.preventDefault();
      void update(true);
    }}>
      {view?.normalApproved ? <fieldset disabled={busy}>
        <label htmlFor={`${id}-class`}>班级</label><select id={`${id}-class`} value={classId} required onChange={event => setClassId(event.target.value)}>
          <option value="">选择班级</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <label htmlFor={`${id}-subject`}>学科</label><input id={`${id}-subject`} value={subject} required maxLength={128} onChange={event => setSubject(event.target.value)} />
        <label htmlFor={`${id}-model`}>模型</label><select id={`${id}-model`} value={model} required onChange={event => setModel(event.target.value)}>
          <option value="">选择模型</option>{availableModels.map(item => <option key={modelKey(item)} value={modelKey(item)}>{item.name ?? item.modelId}</option>)}
        </select>
        <label htmlFor={`${id}-limit`}>调用次数</label><input id={`${id}-limit`} type="number" min={1} max={12} step={1} required value={limit} onChange={event => setLimit(event.target.value)} />
        <label htmlFor={`${id}-until`}>有效期至</label><input id={`${id}-until`} type="datetime-local" required value={validUntil}
          min={localDateTime(new Date(now).toISOString())} max={localDateTime(new Date(now + 7 * 86_400_000).toISOString())}
          onChange={event => { setNow(Date.now()); setValidUntil(event.target.value); }} />
      </fieldset> : null}
      <div className="edupi-admin-work-actions">
        <button type="submit" className="edupi-admin-primary" disabled={busy || !view?.normalApproved || !valid}>开启</button>
        <button type="button" disabled={busy || !view || !view.activation.enabled && !view.config.enabled}
          onClick={() => void update(false)}>停止</button>
      </div>
    </form>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" disabled={busy}
      onClick={() => { setError(""); setView(null); setRefreshKey(value => value + 1); }}>刷新</button></div> : null}
  </div>;
}
