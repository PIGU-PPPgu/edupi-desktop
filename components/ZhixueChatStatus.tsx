"use client";

import { useEffect, useRef, useState } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { parseZhixueFlowStatus, zhixueStatusText, type ZhixueFlowStatus, type ZhixueReceipt } from "@/lib/edupi-zhixue-status";
import { ScanDialog } from "./ChatVisualResult";

const POLL_INTERVAL_MS = 2_000;
const POLL_LIMIT_MS = 18 * 60_000;
const awaiting = (status: string) => status === "starting" || status === "awaiting_scan";

async function readFlow(flowId: string, request: AbortController): Promise<ZhixueFlowStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      request.abort();
      reject(new Error("Scan status request timed out"));
    }, 5_000);
  });
  const read = async () => {
    const response = await fetchDesktopApi(`/api/edupi/zhixue/login/${flowId}`, {
      cache: "no-store",
      signal: request.signal,
    });
    const status = response.ok ? parseZhixueFlowStatus(await response.json()) : null;
    if (!status) throw new Error("Scan status unavailable");
    return status;
  };
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function ZhixueChatStatus({ receipt, currentTurn, autoOpen }: {
  receipt: ZhixueReceipt;
  currentTurn: boolean;
  autoOpen: boolean;
}) {
  const flowId = receipt.flowId;
  const waitingForWorker = awaiting(receipt.status) && flowId !== null && isTauriDesktop();
  const [open, setOpen] = useState(autoOpen && waitingForWorker);
  const autoOpenedFlowId = useRef<string | null>(autoOpen && waitingForWorker ? flowId : null);
  const [observed, setObserved] = useState<ZhixueFlowStatus | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const actual = waitingForWorker ? observed : null;
  const status = actual?.status ?? receipt.status;
  const shouldPoll = waitingForWorker && (currentTurn || open);

  useEffect(() => {
    if (!autoOpen || !waitingForWorker || !awaiting(status) || !flowId || autoOpenedFlowId.current === flowId) return;
    autoOpenedFlowId.current = flowId;
    setOpen(true);
  }, [autoOpen, flowId, status, waitingForWorker]);

  useEffect(() => {
    if (!shouldPoll || !flowId) return;
    const requestedFlow = flowId;
    const deadline = Date.now() + POLL_LIMIT_MS;
    let disposed = false;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function update() {
      request = new AbortController();
      try {
        const status = await readFlow(requestedFlow, request);
        if (disposed) return;
        setObserved(status);
        setReadFailed(false);
        if (!awaiting(status.status)) return;
      } catch {
        if (disposed) return;
        setReadFailed(true);
      } finally {
        request = undefined;
      }
      if (Date.now() < deadline) timer = setTimeout(() => { void update(); }, POLL_INTERVAL_MS);
      else setReadFailed(true);
    }

    void update();
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(timer);
    };
  }, [flowId, shouldPoll]);

  const qr = actual?.status === "awaiting_scan" && actual.qr && !readFailed ? `data:image/png;base64,${actual.qr}` : undefined;
  let message = zhixueStatusText({
    status,
    sync: actual?.status === "authenticated" ? actual.needsSyncConfig ? "needs_config" : "ready" : receipt.sync,
  });
  if (readFailed && awaiting(status)) message = "暂时读不到扫码结果。";
  else if (waitingForWorker && status === "awaiting_scan" && !qr) message = "正在读取二维码，请稍等。";
  const historicalWaiting = awaiting(status) && !currentTurn && !open;
  if (historicalWaiting && !waitingForWorker) return null;
  return <div className="edupi-chat-zhixue-status">
    {!historicalWaiting ? <p ref={statusLine} tabIndex={-1} role={open ? undefined : "status"}>{message}</p> : null}
    {waitingForWorker && awaiting(status) ? <button ref={trigger} type="button"
      className={`edupi-chat-visual-result${qr && currentTurn ? " is-qr" : ""}`} onClick={() => {
        autoOpenedFlowId.current = flowId;
        if (historicalWaiting) {
          setObserved(null);
          setReadFailed(false);
        }
        setOpen(true);
      }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && currentTurn && !open ? <img src={qr} alt="" /> : null}
      <span>{historicalWaiting ? "查看扫码结果" : "打开扫码窗口"}</span>
    </button> : null}
    {open ? <ScanDialog title="智学网登录" src={qr} status={message} onClose={() => {
      setOpen(false);
      requestAnimationFrame(() => (trigger.current ?? statusLine.current)?.focus());
    }} /> : null}
  </div>;
}
