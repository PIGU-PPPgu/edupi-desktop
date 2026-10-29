"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { handleExternalLinkClick } from "@/lib/desktop-native";

const FirstModelSetup = dynamic(() => import("./ModelsConfig").then((module) => module.FirstModelSetup), { ssr: false });

type ProviderStatus = "loading" | "ready" | "error";

export function EduPiOnboardingModelSetup({ onComplete, onAdvanced, onBusyChange }: { onComplete: () => void; onAdvanced: () => void; onBusyChange: (busy: boolean) => void }) {
  const [status, setStatus] = useState<ProviderStatus>("loading");
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    onBusyChange(true);
    fetch("/api/auth/all-providers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("厂商列表读取失败");
        const result = await response.json() as { providers?: Array<{ id?: string }> };
        const ids = result.providers?.map((provider) => provider.id).filter((id): id is string => typeof id === "string") ?? [];
        if (!ids.length) throw new Error("厂商列表为空");
        if (!controller.signal.aborted) { setProviderIds(ids); setStatus("ready"); onBusyChange(false); }
      })
      .catch(() => { if (!controller.signal.aborted) { setStatus("error"); onBusyChange(false); } });
    return () => controller.abort();
  }, [onBusyChange, retry]);

  return <section className="edupi-first-run__inline-model" aria-label="模型连接">
    {status === "loading" ? <p role="status">正在读取模型厂商…</p> : null}
    {status === "error" ? <div className="edupi-first-run__inline-error"><p role="alert">模型厂商暂不可用</p><button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div> : null}
    {status === "ready" ? <FirstModelSetup availableProviderIds={providerIds} onSetupSaved={onComplete} onUseAdvanced={onAdvanced} onBusyChange={onBusyChange} /> : null}
    <details className="edupi-first-run__plan-note"><summary>已有 Coding Plan？</summary><p>编程套餐的适用范围由厂商限定。EduPi 自动备课与名单处理请使用通用 API 模型。</p><a href="https://help.aliyun.com/zh/model-studio/coding-plan-faq" target="_blank" rel="noreferrer" onClick={(event) => handleExternalLinkClick(event, "https://help.aliyun.com/zh/model-studio/coding-plan-faq")}>查看百炼说明 ↗</a><a href="https://docs.bigmodel.cn/cn/coding-plan/overview" target="_blank" rel="noreferrer" onClick={(event) => handleExternalLinkClick(event, "https://docs.bigmodel.cn/cn/coding-plan/overview")}>查看智谱说明 ↗</a></details>
  </section>;
}
