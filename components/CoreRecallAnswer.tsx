"use client";

import { useEffect, useState } from "react";
import type { CoreRecallAnswerState } from "@/lib/edupi-recall-answer";
import {
  CORE_RECALL_INVALIDATED_EVENT, coreRecallAnswerDetails, coreRecallClient, recallViewIsActive, subscribeCoreRecallInvalidation,
  type CoreRecallClient,
} from "@/lib/edupi-recall-answer-client";
import type { CustomMessage } from "@/lib/types";

export function CoreRecallAnswer({ message, sessionId, userEntryId, enabled = false, client = coreRecallClient }: {
  message: CustomMessage;
  sessionId?: string;
  userEntryId?: string;
  enabled?: boolean;
  client?: CoreRecallClient;
}) {
  const details = coreRecallAnswerDetails(message);
  const live = message.coreRecallLive;
  const [manual, setManual] = useState<typeof live>(undefined);
  const candidate = live ?? manual;
  const identity = details && enabled && sessionId === details.sessionId && userEntryId === details.userEntryId
    && candidate?.receiptId === details.receiptId && candidate.clientRequestId === details.clientRequestId ? candidate : null;
  const receiptId = details?.receiptId;
  const [check, setCheck] = useState<{ identity: typeof identity; state: CoreRecallAnswerState } | null>(null);
  const [revoked, setRevoked] = useState(false);
  const validUntil = details?.answer?.valid_until;
  const [deadline, setDeadline] = useState<{ validUntil: string; expired: boolean } | null>(null);
  const expired = !validUntil || deadline?.validUntil !== validUntil || deadline.expired;

  useEffect(() => {
    if (!validUntil) return;
    const remaining = Date.parse(validUntil) - Date.now();
    setDeadline({ validUntil, expired: remaining <= 0 });
    if (remaining <= 0) { setRevoked(true); return; }
    const timer = setTimeout(() => {
      setDeadline({ validUntil, expired: true });
      setRevoked(true);
      window.dispatchEvent(new Event(CORE_RECALL_INVALIDATED_EVENT));
    }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [validUntil]);

  useEffect(() => subscribeCoreRecallInvalidation(() => {
    setManual(undefined);
    setRevoked(true);
  }), []);

  useEffect(() => {
    if (!identity || revoked || !sessionId || !userEntryId || !recallViewIsActive()) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const revoke = () => {
      setRevoked(true);
      window.dispatchEvent(new Event(CORE_RECALL_INVALIDATED_EVENT));
    };
    const verify = async () => {
      // A slow or stalled recheck must not leave the previous green state visible.
      setCheck(null);
      try {
        const state = await client.answerState({ sessionId, userEntryId, receiptId: identity.receiptId }, controller.signal);
        if (stopped || !recallViewIsActive()) return;
        setCheck({ identity, state });
        if (state.status === "current") timer = setTimeout(() => void verify(), 5_000);
        else revoke();
      } catch {
        if (!stopped) {
          setCheck({ identity, state: { version: 1, status: "held", reasonCode: "verification_unavailable" } });
          revoke();
        }
      }
    };
    void verify();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [identity, revoked, sessionId, userEntryId, client]);

  const current = Boolean(identity && check?.identity === identity && check.state.status === "current" && !revoked
    && details?.answer && !expired);
  const held = check?.state.status === "held";
  const text = typeof message.content === "string"
    ? message.content : message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
  return (
    <div className="message-assistant core-recall-answer" data-core-recall-receipt={receiptId} style={{ marginBottom: 16 }}>
      <div role="status" style={{ fontSize: 12, marginBottom: 6, color: current ? "var(--accent)" : "var(--text-muted)" }}>
        {current ? "本轮核验" : revoked ? "来源或页面已变化，未重新核验" : identity && !check ? "核验中" : held ? "未重新核验" : "历史回答，未重新核验"}
      </div>
      {!current && enabled && details?.answer && sessionId === details.sessionId && userEntryId === details.userEntryId && (
        <button type="button" className="native-button" disabled={expired} onClick={() => {
          if (!recallViewIsActive() || Date.parse(details.answer!.valid_until) <= Date.now()) return;
          setCheck(null);
          setRevoked(false);
          setManual({ receiptId: details.receiptId, clientRequestId: details.clientRequestId });
        }} style={{ marginBottom: 8 }}>重新核对</button>
      )}
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</div>
      {details?.answer && (
        <details open style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12 }}>
          <summary style={{ cursor: "pointer" }}>来源</summary>
          <ol style={{ margin: "8px 0", paddingLeft: 24 }}>
            {details.answer.facets.map(facet => {
              const source = details.sources.find(item => item.id === facet.source_id)!;
              return <li key={facet.facet_id} style={{ marginBottom: 8 }}>
                <div style={{ whiteSpace: "pre-wrap" }}>{facet.question}</div>
                {facet.answer.map((answer, index) => <div key={index} style={{ whiteSpace: "pre-wrap" }}>{answer}</div>)}
                <blockquote style={{ margin: "4px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
                  {source.content}
                </blockquote>
                {facet.evidence.filter(quote => quote !== source.content).map((quote, index) => (
                  <blockquote key={index} style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{quote}</blockquote>
                ))}
              </li>;
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
