"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import type { CatalogAction, CatalogProvider, CatalogQuery, CatalogResult } from "@/lib/openconnector-catalog-contract";
import { isGitHubOAuthStatus } from "@/lib/openconnector-github-contract";
import { CONNECTOR_SCENARIOS, connectorScenarioLabel, type ConnectorScenario } from "@/lib/openconnector-discovery";
import { buildConnectionDirectory, connectionPurposeLabel, findConnectionApps, managedConnectionState, type ConnectionApp, type ManagedConnection } from "@/lib/edupi-connection-directory";
import { EduPiConnectorSetup } from "./EduPiConnectorSetup";
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

function ConnectionAppIcon({ app, large = false }: { app: ConnectionApp; large?: boolean }) {
  if (app.iconService) return <OpenConnectorProviderIcon service={app.iconService} displayName={app.displayName} large={large} />;
  return <span className={`openconnector-provider-icon connection-app-icon${large ? " is-large" : ""}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{app.managedId === "email" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></> : app.managedId === "cloud_drive" ? <path d="M7 18h11a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12.3-1A4.5 4.5 0 0 0 7 18Z" /> : <><path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6M3 20h18" /><path d="M10 9h4" /></>}</svg></span>;
}

export function OpenConnectorAdminPanel({ managedConnections = [], onManagedConfigured }: {
  managedConnections?: readonly ManagedConnection[];
  onManagedConfigured?: () => void;
} = {}) {
  const [desktop, setDesktop] = useState(false);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [providerTotal, setProviderTotal] = useState<number | null>(null);
  const [providerLimited, setProviderLimited] = useState(false);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [scenario, setScenario] = useState<ConnectorScenario>("all");
  const [visibleProviderCount, setVisibleProviderCount] = useState(PROVIDER_PAGE_SIZE);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);
  const [githubConnected, setGitHubConnected] = useState(false);
  const [githubLogin, setGitHubLogin] = useState<string | null>(null);
  const [githubHealth, setGitHubHealth] = useState<string>("unknown");
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionRefreshKey, setConnectionRefreshKey] = useState(0);
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
  const providerControllerRef = useRef<AbortController | null>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const purposeHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addConnectionRef = useRef<HTMLButtonElement>(null);
  const purposeTriggerRef = useRef<HTMLButtonElement | null>(null);
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
    setGitHubHealth("unknown");
    if (!connected) setGitHubLogin(null);
  }, []);

  const loadProviders = useCallback(async () => {
    providerControllerRef.current?.abort();
    const controller = new AbortController();
    providerControllerRef.current = controller;
    setProviderLoading(true);
    setProviderError("");
    try {
      const result = await requestCatalog({ op: "providers" }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind !== "providers") throw new Error("目录暂不可用");
      setProviders(result.providers);
      setProviderTotal(result.total);
      setProviderLimited(result.limited);
    } catch (cause) {
      if (!controller.signal.aborted) setProviderError(cause instanceof Error ? cause.message : "目录暂不可用");
    } finally {
      if (providerControllerRef.current === controller) setProviderLoading(false);
    }
  }, []);

  useEffect(() => {
    const available = isTauriDesktop();
    setDesktop(available);
    if (available) void loadProviders();
    const connectionController = new AbortController();
    const connectionVersion = connectionVersionRef.current;
    if (available) void (async () => {
      setConnectionError("");
      try {
        const response = await fetchDesktopApi("/api/desktop/openconnector/github", {
          signal: AbortSignal.any([connectionController.signal, AbortSignal.timeout(5_000)]),
        });
        const body = await response.json().catch(() => null);
        if (!connectionController.signal.aborted && connectionVersion === connectionVersionRef.current
          && response.ok && body?.ok === true && isGitHubOAuthStatus(body.data)) {
          setGitHubConnected(Boolean(body.data.supported && body.data.connection?.authType === "oauth2"));
          setGitHubLogin(body.data.supported ? body.data.connection?.login ?? null : null);
          setGitHubHealth(body.data.health?.status || "unknown");
        } else if (!connectionController.signal.aborted && connectionVersion === connectionVersionRef.current) throw new Error("connection_status_unavailable");
      } catch { if (!connectionController.signal.aborted) setConnectionError("连接状态暂不可用"); }
      finally { if (!connectionController.signal.aborted) setConnectionsLoaded(true); }
    })();
    return () => { controllerRef.current?.abort(); providerControllerRef.current?.abort(); connectionController.abort(); };
  }, [loadProviders, connectionRefreshKey]);

  useLayoutEffect(() => {
    if (selectedAppId) {
      if (scrollRef.current) scrollRef.current.element.scrollTop = 0;
      detailHeadingRef.current?.focus({ preventScroll: true });
    } else if (restoreCatalogRef.current) {
      restoreCatalogRef.current = false;
      providerTriggerRef.current?.focus({ preventScroll: true });
      if (scrollRef.current) scrollRef.current.element.scrollTop = scrollRef.current.top;
    }
  }, [selectedAppId]);
  useLayoutEffect(() => {
    if (catalogOpen) searchRef.current?.focus({ preventScroll: true });
  }, [catalogOpen]);
  useLayoutEffect(() => {
    if (purpose) purposeHeadingRef.current?.focus({ preventScroll: true });
  }, [purpose]);
  useLayoutEffect(() => {
    if (selectedAction) inspectHeadingRef.current?.focus({ preventScroll: true });
    else if (restoreActionRef.current) {
      restoreActionRef.current = false;
      actionTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [selectedAction]);

  const directory = useMemo(() => buildConnectionDirectory(providers, managedConnections, githubConnected), [providers, managedConnections, githubConnected]);
  const selectedApp = directory.find((app) => app.id === selectedAppId) || null;
  const savedApps = directory.filter((app) => app.id === "github" && githubConnected || managedConnectionState(app.managedStatus).saved);
  const searchedApps = useMemo(() => findConnectionApps(directory, providerQuery), [directory, providerQuery]);
  const filteredApps = useMemo(() => findConnectionApps(directory, providerQuery, scenario), [directory, providerQuery, scenario]);
  const scenarioCounts = useMemo(() => new Map(CONNECTOR_SCENARIOS.map((option) => [option.id,
    option.id === "all" ? searchedApps.length : findConnectionApps(searchedApps, "", option.id).length,
  ])), [searchedApps]);
  const hasPurposeChoice = Boolean(selectedApp && (selectedApp.services.length > 1 || selectedApp.managedId && selectedApp.services.length > 0));
  const appStatus = (app: ConnectionApp) => app.id === "github" && githubConnected
    ? githubHealth === "offline" ? "连接中断" : githubHealth === "authorization_required" ? "需要重新授权" : githubHealth === "ready" ? "已连接" : "已授权"
    : managedConnectionState(app.managedStatus).label;

  function clearActions() {
    setSelectedAction(null); setActionsOpen(false); setActionsLoaded(false);
    setActionQuery(""); setActions([]); setProviderActions([]);
    setSearched(false); setLimited(false); setBusy(null); setError("");
  }

  function selectApp(app: ConnectionApp, trigger: HTMLButtonElement) {
    controllerRef.current?.abort();
    controllerRef.current = null;
    providerTriggerRef.current = trigger;
    const scrollElement = catalogRef.current?.closest<HTMLElement>(".edupi-admin-workspace");
    scrollRef.current = scrollElement ? { element: scrollElement, top: scrollElement.scrollTop } : null;
    setSelectedAppId(app.id);
    const immediate = app.managedId && app.services.length === 0 ? "managed" : !app.managedId && app.services.length <= 1 ? app.services[0]?.service || null : null;
    setPurpose(immediate);
    setSelectedProvider(immediate && immediate !== "managed" ? app.services[0] || null : null);
    clearActions();
  }

  function choosePurpose(value: string, trigger: HTMLButtonElement) {
    controllerRef.current?.abort(); controllerRef.current = null;
    purposeTriggerRef.current = trigger;
    setPurpose(value);
    setSelectedProvider(value === "managed" ? null : selectedApp?.services.find((provider) => provider.service === value) || null);
    clearActions();
  }

  function returnToPurposes() {
    controllerRef.current?.abort(); controllerRef.current = null;
    setPurpose(null); setSelectedProvider(null); clearActions();
    requestAnimationFrame(() => purposeTriggerRef.current?.focus({ preventScroll: true }));
  }

  function returnToCatalog() {
    controllerRef.current?.abort(); controllerRef.current = null;
    restoreCatalogRef.current = true;
    setSelectedAppId(null); setPurpose(null); setSelectedProvider(null); clearActions();
  }

  function openCatalog() {
    setCatalogOpen(true);
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

  const providerOperations = selectedProvider ? <>
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
  </> : null;

  return <section className="openconnector-admin connection-settings" aria-label="OpenConnector 目录" data-setting-id="applications">
    <div className="openconnector-admin__catalog" ref={catalogRef} hidden={Boolean(selectedApp)}>
      {!catalogOpen ? <section className="connection-settings__saved" aria-label="我的连接">
        <header><h2>我的连接</h2><button ref={addConnectionRef} type="button" className="edupi-admin-primary" onClick={openCatalog}>添加连接</button></header>
        {connectionError ? <div className="native-inline-alert is-error" role="alert">{connectionError}<button type="button" onClick={() => setConnectionRefreshKey((value) => value + 1)}>重新读取</button></div> : null}
        {savedApps.length ? <ul>{savedApps.map((app) => <li key={app.id}><button type="button" className="connection-settings__saved-app" onClick={(event) => selectApp(app, event.currentTarget)}>
          <ConnectionAppIcon app={app} /><span><strong>{app.displayName}</strong><small>{app.id === "github" ? githubLogin || "OAuth" : app.managedId === "feishu" || app.managedId === "dingtalk" ? "机器人对话" : "学校连接"}</small></span><em>{appStatus(app)}</em><span className="openconnector-admin__chevron" aria-hidden="true">›</span>
        </button></li>)}</ul> : <div className="connection-settings__empty" role="status">{desktop && !connectionsLoaded ? "正在读取连接" : connectionError ? "暂时无法读取已保存的连接" : "还没有添加连接"}</div>}
      </section> : <>
        <button type="button" className="openconnector-admin__back" onClick={() => { setCatalogOpen(false); requestAnimationFrame(() => addConnectionRef.current?.focus()); }}><span aria-hidden="true">←</span> 我的连接</button>
        <div className="openconnector-admin__toolbar">
          <label className="openconnector-admin__search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input ref={searchRef} type="search" aria-label="搜索服务" placeholder="搜索应用" value={providerQuery} disabled={providerLoading} maxLength={120} autoComplete="off" onChange={(event) => { setProviderQuery(event.target.value); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }} /></label>
          <span className="openconnector-admin__count" role="status">{providerLoading ? "正在读取应用" : providerTotal === null ? "外部目录暂不可用" : `${filteredApps.length} 个应用${providerLimited ? " · 目录未完整" : ""}`}</span>
        </div>
        <div className="openconnector-admin__filters" role="group" aria-label="服务场景">
          {CONNECTOR_SCENARIOS.map((option) => <button key={option.id} type="button" aria-pressed={scenario === option.id} disabled={option.id !== "all" && !scenarioCounts.get(option.id)} onClick={() => { setScenario(option.id); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }}>{option.label}</button>)}
        </div>
        {!desktop ? <div className="openconnector-admin__unavailable" role="status">外部应用目录仅桌面应用可查询</div> : null}
        {providerError ? <div className="native-inline-alert is-error" role="alert">{providerError}{!providerLoading ? <button type="button" onClick={() => void loadProviders()}>重试</button> : null}</div> : null}
        <ul className="openconnector-admin__grid" aria-label="服务目录" aria-busy={providerLoading}>
          {filteredApps.slice(0, visibleProviderCount).map((app) => <li key={app.id}><button className="openconnector-admin__provider" type="button" onClick={(event) => selectApp(app, event.currentTarget)}>
            <ConnectionAppIcon app={app} />
            <span className="openconnector-admin__provider-name"><strong>{app.displayName}</strong><small>{app.managedId && app.services.length === 0 ? "学校连接" : CONNECTOR_SCENARIOS.find((item) => item.id === app.scenario)?.label}</small></span>
            {app.id === "github" && githubConnected || managedConnectionState(app.managedStatus).saved ? <span className="openconnector-admin__connected">{appStatus(app)}</span> : <span className="openconnector-admin__chevron" aria-hidden="true">›</span>}
          </button></li>)}
        </ul>
        {providerTotal !== null && filteredApps.length === 0 ? <div className="openconnector-admin__empty" role="status">没有匹配的应用<button type="button" onClick={() => { setProviderQuery(""); setScenario("all"); setVisibleProviderCount(PROVIDER_PAGE_SIZE); }}>清除筛选</button></div> : null}
        {filteredApps.length > visibleProviderCount ? <button className="openconnector-admin__more" type="button" onClick={() => setVisibleProviderCount((count) => count + PROVIDER_PAGE_SIZE)}>显示更多<span>{Math.min(visibleProviderCount, filteredApps.length)} / {filteredApps.length}</span></button> : null}
      </>}
    </div>
    {selectedApp ? <div className="openconnector-admin__detail">
      <button type="button" className="openconnector-admin__back" onClick={returnToCatalog}><span aria-hidden="true">←</span> {catalogOpen ? "返回应用" : "返回我的连接"}</button>
      <header className="openconnector-admin__identity"><ConnectionAppIcon app={selectedApp} large /><div><h2 ref={detailHeadingRef} tabIndex={-1}>{selectedApp.displayName}</h2><span>{CONNECTOR_SCENARIOS.find((item) => item.id === selectedApp.scenario)?.label}</span></div>{selectedApp.id === "github" && githubConnected || managedConnectionState(selectedApp.managedStatus).saved ? <span className="openconnector-admin__connected">{appStatus(selectedApp)}</span> : !selectedApp.managedId && selectedApp.id !== "github" ? <span className="openconnector-admin__scope">只读目录</span> : null}</header>
      {selectedApp.id === "github" ? <OpenConnectorGitHubPanel onConnectionChange={handleConnectionChange} /> : null}
      {hasPurposeChoice ? <section className="connection-settings__purposes" aria-label="连接用途" hidden={Boolean(purpose)}><h3>连接用途</h3><ul>
        {selectedApp.managedId ? <li><button type="button" onClick={(event) => choosePurpose("managed", event.currentTarget)}><span><strong>机器人对话</strong><small>在应用中接收消息并与 EduPi 对话</small></span><em>{managedConnectionState(selectedApp.managedStatus).label}</em><span aria-hidden="true">›</span></button></li> : null}
        {selectedApp.services.map((provider) => <li key={provider.service}><button type="button" onClick={(event) => choosePurpose(provider.service, event.currentTarget)}><span><strong>{connectionPurposeLabel(provider)}</strong><small>{connectorScenarioLabel(provider)}</small></span><em>只读目录</em><span aria-hidden="true">›</span></button></li>)}
      </ul></section> : null}
      {purpose ? <section className="connection-settings__purpose">
        {hasPurposeChoice ? <><button type="button" className="openconnector-admin__back" onClick={returnToPurposes}>← 返回用途</button><h3 ref={purposeHeadingRef} tabIndex={-1}>{purpose === "managed" ? "机器人对话" : selectedProvider ? connectionPurposeLabel(selectedProvider) : "连接设置"}</h3></> : null}
        {purpose === "managed" && selectedApp.managedId ? <EduPiConnectorSetup embedded connectorId={selectedApp.managedId} status={selectedApp.managedStatus || "not_configured"} onClose={hasPurposeChoice ? returnToPurposes : returnToCatalog} onConfigured={() => onManagedConfigured?.()} /> : null}
        {providerOperations}
      </section> : null}
    </div> : null}
  </section>;
}
