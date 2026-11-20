"use client";

import { useEffect, useRef, useState } from "react";
import type { CoreRecallPersonState } from "@/lib/edupi-recall-answer";
import { coreRecallClient, recallViewIsActive, subscribeCoreRecallInvalidation, type CoreRecallClient } from "@/lib/edupi-recall-answer-client";
import { DisclosureChevron } from "./DisclosureChevron";

interface Props {
  sessionId: string;
  entryId: string;
  sourceText: string;
  contextKey?: string;
  client?: CoreRecallClient;
}

export function CoreRecallPersonConfirmation(props: Props) {
  return <PersonConfirmation key={`${props.sessionId}:${props.entryId}:${props.contextKey ?? ""}:${props.sourceText}`} {...props} />;
}

function PersonConfirmation({ sessionId, entryId, sourceText, client = coreRecallClient }: Props) {
  const [open, setOpen] = useState(false);
  const [personName, setPersonName] = useState("");
  const [state, setState] = useState<CoreRecallPersonState | null>(null);
  const [busy, setBusy] = useState<"read" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const previewOperation = useRef<number | null>(null);
  const nameRef = useRef("");
  const openRef = useRef(false);
  const name = personName.trim();
  const validName = name.length > 0 && name.length <= 80 && !/[,，、;；\r\n]/u.test(name) && sourceText.includes(name);

  const reset = () => {
    operation.current++;
    pending.current?.abort();
    pending.current = null;
    locked.current = false;
    setState(null);
    setBusy(null);
    setError(null);
  };
  useEffect(() => {
    const unsubscribe = subscribeCoreRecallInvalidation(() => {
      operation.current++;
      pending.current?.abort();
      locked.current = false;
      setState(null);
      setBusy(null);
      setError(null);
    });
    return () => {
      unsubscribe();
      pending.current?.abort();
    };
  }, [client]);

  const previewValid = state?.status === "current" && state.personName === name && Boolean(state.previewId)
    && state.personRevision !== null && state.personRevision >= 0 && Boolean(state.sourceFingerprint);
  async function request(action: "read" | "confirm") {
    if (locked.current || !openRef.current || nameRef.current !== name || !validName || !recallViewIsActive()
      || action === "confirm" && (!previewValid || previewOperation.current !== operation.current)) return;
    locked.current = true;
    const id = ++operation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(action);
    setError(null);
    if (action === "read") setState(null);
    try {
      const identity = { sessionId, entryId, personName: name };
      const result = await client.person(action === "confirm"
        ? { ...identity, action, previewId: state!.previewId! } : { ...identity, action }, controller.signal);
      if (operation.current !== id || controller.signal.aborted || !recallViewIsActive()) return;
      if (result.personName !== name) throw new Error("人物核对结果不匹配，请重新核对");
      previewOperation.current = action === "read" && result.status === "current" ? id : null;
      setState(result);
    } catch {
      if (operation.current !== id || controller.signal.aborted) return;
      setState(null);
      setError(action === "confirm" ? "确认结果待核对" : "人物核对未完成，请重试");
    } finally {
      if (operation.current === id) {
        locked.current = false;
        pending.current = null;
        setBusy(null);
      }
    }
  }
  return (
    <div className="core-recall-person" style={{ alignSelf: "flex-end", maxWidth: "100%", fontSize: 12, marginTop: 4 }}>
      <button type="button" className="disclosure-trigger is-inline" aria-expanded={open} onClick={() => {
        reset(); openRef.current = !openRef.current; setOpen(openRef.current);
      }} style={{ color: "var(--text-muted)" }}>
        人物 <DisclosureChevron open={open} />
      </button>
      {open && <form aria-label="人物核对" onSubmit={event => { event.preventDefault(); void request("read"); }}
        style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="姓名" value={personName} maxLength={80} placeholder="姓名" autoComplete="off"
            onChange={event => { reset(); nameRef.current = event.target.value.trim(); setPersonName(event.target.value); }} style={{ minWidth: 0, maxWidth: "100%" }} />
          <button type="submit" className="native-button" disabled={!validName || Boolean(busy)}>{busy === "read" ? "核对中" : "核对"}</button>
          <button type="button" className="native-button" onClick={() => {
            reset(); nameRef.current = ""; openRef.current = false; setPersonName(""); setOpen(false);
          }}>取消</button>
        </div>
        {previewValid && !busy && <button type="button" className="native-button" onClick={() => void request("confirm")}>确认人物</button>}
        {busy === "confirm" && <span role="status">确认中</span>}
        {state?.status === "confirmed" || state?.status === "replayed" ? <span role="status">已确认：{state.personName}</span> : null}
        {state?.status === "held" && <span role="alert">{state.factWrite === null || state.reasonCode === "confirmation_unknown"
          ? "确认结果待核对" : state.factWrite ? "已保存，但来源已变化，请重新核对" : "当前来源不能确认此人物，请重新核对"}</span>}
        {error && <span role="alert">{error}</span>}
      </form>}
    </div>
  );
}
