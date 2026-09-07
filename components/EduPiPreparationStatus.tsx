"use client";
import { useEffect, useRef, useState } from "react";

type Status = { state: "idle" | "running" | "ready" | "error"; updatedAt: string | null; prepared: number; error: string | null };
export function EduPiPreparationStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const lastUpdate = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch("/api/edupi/preparation", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const next = await response.json() as Status;
        if (!active) return;
        setStatus(next);
        if (next.updatedAt && next.updatedAt !== lastUpdate.current && next.state !== "running") {
          lastUpdate.current = next.updatedAt;
          window.dispatchEvent(new Event("edupi-preparation-updated"));
        }
      } catch { /* A later poll restores status after reconnect. */ }
    };
    void read();
    const timer = window.setInterval(() => void read(), 10_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, []);
  const run = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/edupi/preparation", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({action:"run"}) });
      const next = await response.json() as Status;
      setStatus(next);
    } catch { setStatus({state:"error",updatedAt:null,prepared:0,error:"连接失败，请重试"}); }
    finally { setBusy(false); }
  };
  return <div className="edupi-preparation-status" role="status"><span>{status?.state === "running" ? "正在准备未来两天的课程…" : status?.state === "error" ? status.error : status?.state === "ready" ? `本轮准备 ${status.prepared} 项` : "课前准备"}</span><button type="button" disabled={busy || status?.state === "running"} onClick={() => void run()}>{status?.state === "error" ? "重试" : "立即检查"}</button></div>;
}
