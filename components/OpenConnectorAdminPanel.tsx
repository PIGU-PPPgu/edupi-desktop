"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import type { CatalogAction, CatalogProvider, CatalogQuery, CatalogResult } from "@/lib/openconnector-catalog-contract";
import { isGitHubOAuthStatus } from "@/lib/openconnector-github-contract";
import { CONNECTOR_SCENARIOS, connectorScenario, connectorScenarioLabel, discoverConnectorProviders, type ConnectorScenario } from "@/lib/openconnector-discovery";
import { OpenConnectorGitHubPanel } from "./OpenConnectorGitHubPanel";
import { OpenConnectorProviderIcon } from "./OpenConnectorProviderIcon";

type InspectResult = Extract<CatalogResult, { kind: "inspect" }>;
const PROVIDER_PAGE_SIZE = 48;

function isAction(value: unknown): value is CatalogAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.service === "string"
    && typeof item.name === "string" && typeof item.description === "string";
}

function isProvider(value: unknown): value is CatalogProvider {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.service === "string" && typeof item.displayName === "string"
    && typeof item.scenario === "string" && Array.isArray(item.categories)
    && item.categories.every((name: unknown) => typeof name === "string")
    && Array.isArray(item.authTypes) && item.authTypes.every((name: unknown) => typeof name === "string");
}

export function isCatalogResult(value: unknown): value is CatalogResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.kind === "providers") return Array.isArray(result.providers) && result.providers.every(isProvider)
    && Number.isSafeInteger(result.total) && (result.total as number) >= result.providers.length && typeof result.limited === "boolean";
  if (result.kind === "actions") return typeof result.service === "string" && Array.isArray(result.actions)
    && result.actions.every((action: unknown) => isAction(action) && action.service === result.service)
    && Number.isSafeInteger(result.total) && (result.total as number) >= result.actions.length && typeof result.limited === "boolean";
  if (result.kind === "search") return Array.isArray(result.actions)
    && result.actions.every(isAction) && typeof result.limited === "boolean";
  if (result.kind === "inspect") return isAction(result.action)
    && Array.isArray(result.fields)
    && result.fields.every((field: unknown) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) return false;
      const item = field as Record<string, unknown>;
      return typeof item.name === "string" && typeof item.type === "string"
        && typeof item.description === "string" && typeof item.required === "boolean";
    }) && typeof result.limited === "boolean";
  return false;
}

async function requestCatalog(input: CatalogQuery, signal: AbortSignal): Promise<CatalogResult> {
  if (!isTauriDesktop()) throw new Error("仅桌面应用可查询");
  for (const delay of [0, 300, 800, 1_600]) {
    if (delay) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const response = await fetchDesktopApi("/api/desktop/openconnector/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (response.status === 429 && delay !== 1_600) continue;
    const body = await response.json().catch(() => null) as { ok?: unknown; data?: unknown } | null;
    if (!response.ok || body?.ok !== true || !isCatalogResult(body.data)) {
      throw new Error(response.status === 429 ? "目录正忙，请重试" : "目录暂不可用");
    }
    return body.data;
  }
  throw new Error("目录暂不可用");
}

export function OpenConnectorAdminPanel() {
  const [desktop, setDesktop] = useState(false);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [providerTotal, setProviderTotal] = useState<number | null>(null);
  const [providerLimited, setProviderLimited] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [scenario, setScenario] = useState<ConnectorScenario>("all");
  const [visibleProviderCount, setVisibleProviderCount] = useState(PROVIDER_PAGE_SIZE);
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);
  const [githubConnected, setGitHubConnected] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsLoaded, setActionsLoaded] = useState(false);
  const [providerActions, setProviderActions] = useState<CatalogAction[]>([]);
  const [providerActionsLimited, setProviderActionsLimited] = useState(false);
  const [actions, setActions] = useState<CatalogAction[]>([]);
  const [actionQuery, setActionQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [limited, setLimited] = useState(false);
  const [selectedAction, setSelectedAction] = useState<InspectResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const inspectHeadingRef = useRef<HTMLHeadingElement>(null);
  const providerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<{ element: HTMLElement; top: number } | null>(null);
  const restoreCatalogRef = useRef(false);
  const restoreActionRef = useRef(false);
  const connectionVersionRef = useRef(0);
  const handleConnectionChange = useCallback((connected: boolean) => {
    connectionVersionRef.current += 1;
    setGitHubConnected(connected);
  }, []);

  const loadProviders = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("providers");
    setError("");
    try {
      const result = await requestCatalog({ op: "providers" }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "providers") throw new Error("目录暂不可用");
      setProviders(result.providers);
      setProviderTotal(result.total);
      setProviderLimited(result.limited);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }, []);

  useEffect(() => {
    const available = isTauriDesktop();
    setDesktop(available);
    if (available) void loadProviders();
    const connectionController = new AbortController();
    const connectionVersion = connectionVersionRef.current;
    if (available) void (async () => {
      try {
        const response = await fetchDesktopApi("/api/desktop/openconnector/github", {
          signal: AbortSignal.any([connectionController.signal, AbortSignal.timeout(5_000)]),
        });
        const body = await response.json().catch(() => null);
        if (!connectionController.signal.aborted && connectionVersion === connectionVersionRef.current
          && response.ok && body?.ok === true && isGitHubOAuthStatus(body.data)) {
          setGitHubConnected(Boolean(body.data.supported && body.data.connection?.authType === "oauth2"));
        }
      } catch { /* Connection discovery does not block the service directory. */ }
    })();
    return () => { controllerRef.current?.abort(); connectionController.abort(); };
  }, [loadProviders]);

  useLayoutEffect(() => {
    if (selectedProvider) {
      if (scrollRef.current) scrollRef.current.element.scrollTop = 0;
      detailHeadingRef.current?.focus({ preventScroll: true });
    } else if (restoreCatalogRef.current) {
      restoreCatalogRef.current = false;
      providerTriggerRef.current?.focus({ preventScroll: true });
      if (scrollRef.current) scrollRef.current.element.scrollTop = scrollRef.current.top;
    }
  }, [selectedProvider]);
  useLayoutEffect(() => {
    if (selectedAction) inspectHeadingRef.current?.focus({ preventScroll: true });
    else if (restoreActionRef.current) {
      restoreActionRef.current = false;
      actionTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [selectedAction]);

  const connectedServices = useMemo(() => new Set(githubConnected ? ["github"] : []), [githubConnected]);
  const searchedProviders = useMemo(() => discoverConnectorProviders(providers, {
    query: providerQuery, connectedServices,
  }), [providers, providerQuery, connectedServices]);
  const filteredProviders = useMemo(() => scenario === "all" ? searchedProviders
    : searchedProviders.filter((provider) => connectorScenario(provider) === scenario), [searchedProviders, scenario]);
  const scenarioCounts = useMemo(() => new Map(CONNECTOR_SCENARIOS.map((option) => [option.id,
    option.id === "all" ? searchedProviders.length
      : searchedProviders.filter((provider) => connectorScenario(provider) === option.id).length,
  ])), [searchedProviders]);

  function selectProvider(provider: CatalogProvider, trigger: HTMLButtonElement) {
    controllerRef.current?.abort();
    controllerRef.current = null;
    providerTriggerRef.current = trigger;
    const scrollElement = catalogRef.current?.closest<HTMLElement>(".edupi-admin-workspace");
    scrollRef.current = scrollElement ? { element: scrollElement, top: scrollElement.scrollTop } : null;
    setSelectedProvider(provider);
    setSelectedAction(null);
    setActionsOpen(false);
    setActionsLoaded(false);
    setActionQuery("");
    setActions([]);
    setProviderActions([]);
    setSearched(false);
    setLimited(false);
    setBusy(null);
    setError("");
  }

  function returnToCatalog() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    restoreCatalogRef.current = true;
    setSelectedProvider(null);
    setSelectedAction(null);
    setBusy(null);
    setError("");
  }

  async function loadProviderActions(provider: CatalogProvider) {
    if (busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("actions");
    setError("");
    try {
      const result = await requestCatalog({ op: "actions", service: provider.service }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "actions" || result.service !== provider.service) throw new Error("目录暂不可用");
      setProviderActions(result.actions);
      setProviderActionsLimited(result.limited);
      setActions(result.actions);
      setActionsLoaded(true);
      setSearched(true);
      setLimited(result.limited);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  async function searchActions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = actionQuery.trim();
    if (!query || busy || !selectedProvider) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("search");
    setError("");
    setSelectedAction(null);
    setSearched(false);
    try {
      const result = await requestCatalog({ op: "search", query, service: selectedProvider.service }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "search" || result.actions.some((action) => action.service !== selectedProvider.service)) throw new Error("目录暂不可用");
      setActions(result.actions);
      setLimited(result.limited);
      setSearched(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  async function inspectAction(action: CatalogAction, trigger: HTMLButtonElement) {
    if (busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    actionTriggerRef.current = trigger;
    setBusy("inspect");
    setError("");
    try {
      const result = await requestCatalog({ op: "inspect", actionId: action.id }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "inspect" || result.action.id !== action.id
        || selectedProvider && result.action.service !== selectedProvider.service) throw new Error("目录暂不可用");
      setSelectedAction(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  function changeActionQuery(value: string) {
    setActionQuery(value);
    setSelectedAction(null);
    setActions(value.trim() ? [] : providerActions);
    setSearched(!value.trim() && actionsLoaded);
    setLimited(!value.trim() && providerActionsLimited);
  }

  return <section className="openconnector-admin" aria-label="OpenConnector 目录">
    {!desktop ? <div className="openconnector-admin__unavailable" role="status">仅桌面应用可查询</div> : <>
      <div className="openconnector-admin__catalog" ref={catalogRef} hidden={Boolean(selectedProvider)}>
        <div className="openconnector-admin__toolbar">
          <label className="openconnector-admin__search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input type="search" aria-label="搜索服务" placeholder="搜索服务" value={providerQuery} disabled={busy === "providers"} maxLength={120} autoComplete="off" onChange={(event) => { setProviderQuery(event.target.value); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }} /></label>
          <span className="openconnector-admin__count" role="status">{busy === "providers" ? "正在读取服务" : providerTotal === null ? "服务目录暂不可用" : `${filteredProviders.length} 个服务${providerLimited ? " · 目录未完整" : ""}`}</span>
        </div>
        <div className="openconnector-admin__filters" role="group" aria-label="服务场景">
          {CONNECTOR_SCENARIOS.map((option) => <button key={option.id} type="button" aria-pressed={scenario === option.id} disabled={busy === "providers" || option.id !== "all" && !scenarioCounts.get(option.id)} onClick={() => { setScenario(option.id); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }}>{option.label}</button>)}
        </div>
        {error && !selectedProvider ? <div className="native-inline-alert is-error" role="alert">{error}{busy === null ? <button type="button" onClick={() => void loadProviders()}>重试</button> : null}</div> : null}
        <ul className="openconnector-admin__grid" aria-label="服务目录" aria-busy={busy === "providers"}>
          {filteredProviders.slice(0, visibleProviderCount).map((provider) => <li key={provider.service}><button className="openconnector-admin__provider" type="button" disabled={busy === "providers"} onClick={(event) => selectProvider(provider, event.currentTarget)}>
            <OpenConnectorProviderIcon service={provider.service} displayName={provider.displayName} />
            <span className="openconnector-admin__provider-name"><strong>{provider.displayName}</strong><small>{connectorScenarioLabel(provider)}</small></span>
            {connectedServices.has(provider.service) ? <span className="openconnector-admin__connected">已连接</span> : <span className="openconnector-admin__chevron" aria-hidden="true">›</span>}
          </button></li>)}
        </ul>
        {providerTotal !== null && filteredProviders.length === 0 ? <div className="openconnector-admin__empty" role="status">没有匹配的服务<button type="button" onClick={() => { setProviderQuery(""); setScenario("all"); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }}>清除筛选</button></div> : null}
        {filteredProviders.length > visibleProviderCount ? <button className="openconnector-admin__more" type="button" onClick={() => setVisibleProviderCount((count) => count + PROVIDER_PAGE_SIZE)}>显示更多<span>{Math.min(visibleProviderCount, filteredProviders.length)} / {filteredProviders.length}</span></button> : null}
      </div>
      {selectedProvider ? <div className="openconnector-admin__detail">
        <button type="button" className="openconnector-admin__back" onClick={returnToCatalog}><span aria-hidden="true">←</span> 返回服务</button>
        <header className="openconnector-admin__identity"><OpenConnectorProviderIcon service={selectedProvider.service} displayName={selectedProvider.displayName} large /><div><h2 ref={detailHeadingRef} tabIndex={-1}>{selectedProvider.displayName}</h2><span>{connectorScenarioLabel(selectedProvider)}<code>{selectedProvider.service}</code></span></div>{selectedProvider.service === "github" ? githubConnected ? <span className="openconnector-admin__connected">已连接</span> : null : <span className="openconnector-admin__scope">只读目录</span>}</header>
        {selectedProvider.service === "github" ? <OpenConnectorGitHubPanel onConnectionChange={handleConnectionChange} /> : null}
        <details className="openconnector-admin__operations" open={actionsOpen} onToggle={(event) => {
          const open = event.currentTarget.open;
          setActionsOpen(open);
          if (open && !actionsLoaded && !busy) void loadProviderActions(selectedProvider);
        }}><summary>操作目录</summary>
          {error ? <div className="native-inline-alert is-error" role="alert">{error}{busy === null && !actionsLoaded ? <button type="button" onClick={() => void loadProviderActions(selectedProvider)}>重试读取</button> : null}</div> : null}
          <div className="openconnector-admin__actions" hidden={Boolean(selectedAction)}>
            <form role="search" onSubmit={(event) => void searchActions(event)}><label><input type="search" aria-label="搜索操作" placeholder="搜索操作" value={actionQuery} disabled={busy !== null} maxLength={200} autoComplete="off" onChange={(event) => changeActionQuery(event.target.value)} /></label><button type="submit" disabled={busy !== null || !actionQuery.trim()}>查找</button></form>
            <div className="openconnector-admin__count" role="status">{busy === "actions" ? "正在读取操作" : busy === "search" ? "正在查找" : busy === "inspect" ? "正在读取参数" : searched ? `${actions.length} 项操作${limited ? " · 可缩小关键词" : ""}` : ""}</div>
            {searched && actions.length > 0 ? <ul>{actions.map((action) => <li key={action.id}><button type="button" disabled={busy !== null} onClick={(event) => void inspectAction(action, event.currentTarget)}><strong>{action.name}</strong><small>{action.description || action.id}</small><span aria-hidden="true">›</span></button></li>)}</ul> : null}
          </div>
          {selectedAction ? <section className="openconnector-admin__inspect" aria-label={`${selectedAction.action.name} 参数`}>
            <button type="button" className="openconnector-admin__back" onClick={() => { restoreActionRef.current = true; setSelectedAction(null); }}>← 返回操作</button>
            <h3 ref={inspectHeadingRef} tabIndex={-1}>{selectedAction.action.name}</h3><code>{selectedAction.action.id}</code>
            <dl>{selectedAction.fields.map((field) => <div key={field.name}><dt>{field.name}{field.required ? " · 必填" : ""}</dt><dd>{field.description || field.type}</dd></div>)}</dl>
            {selectedAction.fields.length === 0 ? <small>无需输入参数</small> : null}{selectedAction.limited ? <small>仅显示前 30 项参数</small> : null}
          </section> : null}
        </details>
      </div> : null}
    </>}
  </section>;
}
