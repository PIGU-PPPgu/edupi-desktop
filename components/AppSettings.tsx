"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AppComponentReleaseInfo, AppUpdatesResponse } from "@/lib/app-update-types";
import {
  APP_DISTRIBUTION_NAME,
  APP_RELEASES_URL,
  APP_VERSION,
  APP_VERSION_DISPLAY,
} from "@/lib/branding";
import { compareAppVersions, hasAppUpdateCheckError } from "@/lib/app-updates";
import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "@/lib/app-prefs";
import type { ComputerUseStatus } from "@/lib/edupi-computer-use";
import {
  emergencyStopComputerUseNative,
  getComputerUseStatusNative,
  requestComputerUsePermissionNative,
  setComputerUseEnabledNative,
} from "@/lib/desktop-computer-use";
import {
  installLatestDesktopRelease,
  desktopUpgradeErrorDetails,
  desktopUpgradeErrorKind,
  isTauriDesktop,
  type DesktopUpgradeProgress,
} from "@/lib/desktop-updater";
import type { DesktopUpgradeErrorStage } from "@/lib/desktop-updater";
import {
  getEduPiRootStatusNative,
  getNotificationPermissionStatusNative,
  handleExternalLinkClick,
  quitAppNative,
  relaunchAppNative,
  resetEduPiDataRootNative,
  selectDirectoryNative,
  setCloseQuitsNative,
  setEduPiDataRootNative,
  type EduPiRootStatus,
  type NotificationPermissionStatus,
} from "@/lib/desktop-native";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { testDesktopNotification } from "@/lib/desktop-notify";
import {
  computerUsePermissionFlowAfterStatus,
  computerUsePermissionLabel,
  computerUseHostLabel,
  computerUsePrimaryAction,
  computerUsePrimaryActionLabel,
  type ComputerUsePermissionFlow,
} from "@/lib/computer-use-permissions";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { UpdateProxySettingsCard } from "./UpdateProxySettingsCard";
import { announceComputerUseChanged, COMPUTER_USE_CHANGED_EVENT } from "./EduPiComputerUseStop";
import { MobileBridgeSettingsCard } from "./MobileBridgeSettingsCard";
import { EduPiUsageSettingsCard } from "./EduPiUsageSettingsCard";
import { readForegroundSettings, writeForegroundSettings } from "@/lib/edupi-foreground-settings";

const sectionCardStyle: CSSProperties = {
  padding: "13px 14px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
};

const sectionHintStyle: CSSProperties = {
  marginTop: 3,
  color: "var(--text-muted)",
  fontSize: 12,
  lineHeight: 1.5,
};

function notificationStatusLabel(status: NotificationPermissionStatus | null): string {
  if (!status) return "不可用";
  if (status.authorizationStatus === 0) return "待授权";
  if (status.authorizationStatus === 1) return "已拒绝";
  if (status.authorizationStatus < 0) return "无需";
  if (status.notificationCenterSetting !== 2) return "通知中心关闭";
  if (status.alertSetting !== 2) return "横幅关闭";
  if (status.soundSetting !== 2) return "声音关闭";
  return "已开启";
}

export type AppSettingsPage = "general" | "profile" | "notifications" | "devices" | "data" | "about";

const PAGE_TITLES: Record<AppSettingsPage, string> = {
  general: "常规", profile: "教师信息", notifications: "通知", devices: "设备与权限", data: "数据与隐私", about: "关于与更新",
};

function SettingsRow({ id, label, description, children }: { id: string; label: string; description?: string; children: ReactNode }) {
  return <div className="app-settings-row" data-setting-id={id} tabIndex={-1}>
    <div className="app-settings-row__label"><span>{label}</span>{description ? <small>{description}</small> : null}</div>
    <div className="app-settings-row__control">{children}</div>
  </div>;
}

function SettingsToggleRow({ id, label, hint, checked, onChange, disabled = false }: { id: string; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="app-settings-row app-settings-toggle" data-setting-id={id} tabIndex={-1}>
    <span className="app-settings-row__label"><span>{label}</span>{hint ? <small id={`${id}-hint`}>{hint}</small> : null}</span>
    <input type="checkbox" role="switch" checked={checked} aria-checked={checked} aria-describedby={hint ? `${id}-hint` : undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

function TeacherContextSettingsCard({ disabled = false }: { disabled?: boolean }) {
  const [context, setContext] = useState<TeacherContextSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/edupi/onboarding", { cache: "no-store", signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("context_unavailable");
      return response.json();
    }).then((value: TeacherContextSnapshot) => { if (!controller.signal.aborted) setContext(value); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  const rows = [
    ["称呼", context?.name], ["学校", context?.school], ["学科", context?.subject], ["年级", context?.grade], ["班级", context?.classes?.join("、")],
  ];
  return <div className="app-settings-context" data-setting-id="teacher-profile" tabIndex={-1}>
    {error ? <p className="app-settings-error" role="alert">教师信息暂不可用</p> : <dl className="app-settings-profile">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{context ? value || "未设置" : "正在读取"}</dd></div>)}</dl>}
    <div className="app-settings-actions"><button type="button" className="native-button" disabled={disabled} onClick={() => window.dispatchEvent(new CustomEvent("edupi-open-context"))}>编辑资料</button></div>
  </div>;
}

function ForegroundSettingsCard() {
  const [settings, setSettings] = useState(readForegroundSettings);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setSettings(readForegroundSettings());
    const failed = () => setError("当前窗口已生效，重启设置未保存");
    window.addEventListener("edupi-foreground-settings-changed", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("edupi-foreground-save-failed", failed);
    return () => { window.removeEventListener("edupi-foreground-settings-changed", refresh); window.removeEventListener("storage", refresh); window.removeEventListener("edupi-foreground-save-failed", failed); };
  }, []);
  return <div data-setting-id="foreground" tabIndex={-1}><label className="app-settings-row settings-foreground-days"><span>过期事务收起</span><span className="app-settings-row__control"><input type="number" min={0} max={365} step={1} value={settings.graceDays} aria-label="过期事务收起天数" onChange={event => {
    const days = event.currentTarget.valueAsNumber;
    if (!Number.isInteger(days) || days < 0 || days > 365) return;
    const next = { ...readForegroundSettings(), graceDays: days };
    void writeForegroundSettings(next).then(() => setError(null), () => setError("当前窗口已生效，重启设置未保存"));
    setSettings(next);
  }} /><span>天后</span></span></label>{error ? <div className="app-settings-error" role="alert">{error}</div> : null}<details className="app-settings-help"><summary>收起规则</summary><p>只收起前台，不删除记录；可在历史中找回。课前工作按上课日期判断。</p></details></div>;
}

function ComputerUseSettingsCard() {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [flow, setFlow] = useState<ComputerUsePermissionFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flowRef = useRef<ComputerUsePermissionFlow | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const statusRequestRef = useRef(0);
  const focusReturnRef = useRef<{ target: HTMLButtonElement; moved: boolean; cancel: () => void } | null>(null);
  const [completedAction, setCompletedAction] = useState(0);

  const beginAction = useCallback((trigger?: HTMLButtonElement) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    ++statusRequestRef.current;
    focusReturnRef.current?.cancel();
    focusReturnRef.current = null;
    if (trigger) {
      const doc = trigger.ownerDocument;
      const active = doc.activeElement;
      if (active === trigger || active === doc.body || active === doc.documentElement) {
        const pending = { target: trigger, moved: false, cancel: () => doc.removeEventListener("focusin", trackFocus) };
        const trackFocus = (event: FocusEvent) => {
          if (event.target !== trigger && event.target !== doc.body && event.target !== doc.documentElement) pending.moved = true;
        };
        doc.addEventListener("focusin", trackFocus);
        focusReturnRef.current = pending;
      }
    }
    setBusy(true);
    setError(null);
    return true;
  }, []);

  const finishAction = useCallback(() => {
    busyRef.current = false;
    if (!mountedRef.current) return;
    setBusy(false);
    setCompletedAction((current) => current + 1);
  }, []);

  useEffect(() => {
    if (busy) return;
    const pending = focusReturnRef.current;
    if (!pending) return;
    focusReturnRef.current = null;
    pending.cancel();
    const root = rootRef.current;
    if (pending.moved || !root?.isConnected || root.closest("[hidden]")) return;
    const doc = pending.target.ownerDocument;
    const active = doc.activeElement;
    if (active && active !== pending.target && active !== doc.body && active !== doc.documentElement) return;
    const target = pending.target.isConnected ? pending.target : primaryButtonRef.current;
    if (target?.isConnected && !target.disabled && root.contains(target)) target.focus({ preventScroll: true });
  }, [busy, completedAction]);

  const setPermissionFlow = useCallback((next: ComputerUsePermissionFlow | null) => {
    flowRef.current = next;
    setFlow(next);
  }, []);

  const requestPermission = useCallback(async (permission: "accessibility" | "screen_recording") => {
    busyRef.current = true;
    const requestId = ++statusRequestRef.current;
    const isCurrent = () => mountedRef.current && requestId === statusRequestRef.current;
    setBusy(true);
    setError(null);
    try {
      const pendingFlow: ComputerUsePermissionFlow = permission === "accessibility"
        ? { permission, screenRecordingRequested: false }
        : { permission, screenRecordingRequested: true };
      setPermissionFlow(pendingFlow);
      let next = await requestComputerUsePermissionNative(permission);
      if (!isCurrent()) return;

      if (
        permission === "accessibility"
        && next.accessibility !== false
        && next.screenRecording === false
      ) {
        const screenFlow: ComputerUsePermissionFlow = {
          permission: "screen_recording",
          screenRecordingRequested: true,
        };
        setPermissionFlow(screenFlow);
        next = await requestComputerUsePermissionNative("screen_recording");
        if (!isCurrent()) return;
        setPermissionFlow(computerUsePermissionFlowAfterStatus(next, screenFlow));
      } else {
        setPermissionFlow(computerUsePermissionFlowAfterStatus(next, pendingFlow));
      }
      setStatus(next);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishAction();
    }
  }, [finishAction, setPermissionFlow]);

  const readStatus = useCallback(async (currentFlow: ComputerUsePermissionFlow | null, enabledFromEvent?: boolean) => {
    const requestId = ++statusRequestRef.current;
    const isCurrent = () => mountedRef.current && requestId === statusRequestRef.current;
    try {
      const next = await getComputerUseStatusNative();
      if (!isCurrent()) return;
      const resolvedFlow = computerUsePermissionFlowAfterStatus(next, currentFlow);
      setStatus(enabledFromEvent === undefined ? next : { ...next, enabled: enabledFromEvent });
      setError(null);
      setPermissionFlow(resolvedFlow);
      if (currentFlow?.permission === "accessibility" && resolvedFlow?.permission === "screen_recording") {
        await requestPermission("screen_recording");
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [requestPermission, setPermissionFlow]);

  const refreshStatus = useCallback(async (trigger?: HTMLButtonElement) => {
    if (!beginAction(trigger)) return;
    try {
      await readStatus(flowRef.current);
    } finally {
      finishAction();
    }
  }, [beginAction, finishAction, readStatus]);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++statusRequestRef.current;
    const isCurrent = () => mountedRef.current && requestId === statusRequestRef.current;
    void getComputerUseStatusNative()
      .then((value) => { if (isCurrent()) setStatus(value); })
      .catch((cause) => { if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      mountedRef.current = false;
      focusReturnRef.current?.cancel();
      focusReturnRef.current = null;
    };
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      ++statusRequestRef.current;
      const enabled = (event as CustomEvent<boolean>).detail === true;
      setStatus((current) => current ? { ...current, enabled } : current);
      if (!status) void readStatus(flowRef.current, enabled);
    };
    window.addEventListener(COMPUTER_USE_CHANGED_EVENT, update);
    return () => window.removeEventListener(COMPUTER_USE_CHANGED_EVENT, update);
  }, [readStatus, status]);

  useEffect(() => {
    const refreshAfterSystemSettings = () => { if (!busyRef.current) void readStatus(flowRef.current); };
    window.addEventListener("focus", refreshAfterSystemSettings);
    return () => window.removeEventListener("focus", refreshAfterSystemSettings);
  }, [readStatus]);

  useEffect(() => {
    if (flow?.permission !== "accessibility" || busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busyRef.current) void readStatus(flowRef.current);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [busy, flow?.permission, readStatus]);

  const updateEnabled = async (enabled: boolean, trigger?: HTMLButtonElement) => {
    if (!beginAction(trigger)) return;
    const requestId = statusRequestRef.current;
    const isCurrent = () => mountedRef.current && requestId === statusRequestRef.current;
    try {
      const next = enabled ? await setComputerUseEnabledNative(true) : await emergencyStopComputerUseNative();
      if (requestId !== statusRequestRef.current) return;
      if (mountedRef.current) setStatus(next);
      setPrefBool(APP_PREF_KEYS.computerUseEnabled, next.enabled);
      announceComputerUseChanged(next.enabled);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishAction();
    }
  };

  const restartForPermission = async () => {
    if (!beginAction()) return;
    try {
      setPrefBool(APP_PREF_KEYS.computerUseEnabled, true);
      await relaunchAppNative();
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishAction();
    }
  };

  const primaryAction = computerUsePrimaryAction({ status, flow });
  const runPrimaryAction = async (trigger: HTMLButtonElement) => {
    if (busyRef.current) return;
    if (primaryAction.kind === "detect") return refreshStatus(trigger);
    if (primaryAction.kind === "request") return requestPermission(primaryAction.permission);
    if (primaryAction.kind === "restart") return restartForPermission();
    return updateEnabled(primaryAction.kind === "enable", trigger);
  };
  const activePermission = flow?.permission;
  return <div ref={rootRef} className="native-settings-card app-settings-device" data-setting-id="computer-use" tabIndex={-1} style={sectionCardStyle}>
    <div style={sectionTitleStyle}>桌面控制</div>
    <details className="settings-permission-identity"><summary>{computerUseHostLabel(status?.host)}</summary><dl>
      <div><dt>安装路径</dt><dd>{status?.host?.bundlePath || status?.host?.executablePath || "未检测"}</dd></div>
      <div><dt>应用标识</dt><dd>{status?.host?.bundleId || "未检测"}</dd></div>
      <div><dt>签名团队</dt><dd>{status?.host?.signingTeam || "无法检测"}</dd></div>
      <div><dt>探测进程</dt><dd>{status?.host?.processId || "未检测"}</dd></div>
    </dl></details>
    <div className="computer-use-settings">
      <div className="computer-use-status-row"><strong>总开关</strong><span className={status?.enabled ? "is-ready" : "is-off"}>{status?.enabled ? "已开启" : "已关闭"}</span></div>
      <div className={activePermission === "accessibility" ? "computer-use-status-row is-active" : "computer-use-status-row"}><strong>辅助功能</strong><span className={status?.accessibility ? "is-ready" : "is-off"}>{computerUsePermissionLabel(status?.accessibility)}</span></div>
      <div className={activePermission === "screen_recording" ? "computer-use-status-row is-active" : "computer-use-status-row"}><strong>屏幕录制</strong><span className={status?.screenRecording ? "is-ready" : "is-off"}>{computerUsePermissionLabel(status?.screenRecording, flow?.screenRecordingRequested)}</span></div>
      <div className="computer-use-actions">
        <button ref={primaryButtonRef} type="button" className="native-button native-button-primary computer-use-primary-action" disabled={busy} onClick={(event) => void runPrimaryAction(event.currentTarget)}>{computerUsePrimaryActionLabel(primaryAction)}</button>
        <button type="button" className="native-button native-button-compact" disabled={busy} onClick={(event) => void refreshStatus(event.currentTarget)} aria-label="重新检测权限" title="重新检测权限">↻</button>
        {status?.enabled && primaryAction.kind !== "stop" ? <button type="button" className="native-button native-button-compact" disabled={busy} onClick={(event) => void updateEnabled(false, event.currentTarget)} aria-label="停止控制" title="停止控制">×</button> : null}
      </div>
      <details><summary>权限用途</summary><p style={sectionHintStyle}>辅助功能用于键盘与鼠标操作，屏幕录制用于读取屏幕；每次操作仍需你确认。请核对上方正式应用路径，不要授权旧 Canary。系统开关已开启但检测未更新时，退出并重启此应用后再检测。</p></details>
      {flow?.permission === "accessibility" ? <div style={sectionHintStyle} role="status">请在系统设置授权上方应用后返回。{status?.accessibility === false ? <button type="button" className="native-button" onClick={() => void restartForPermission()} disabled={busy}>已授权，重启核对</button> : null}</div> : null}
      {flow?.permission === "screen_recording" && flow.screenRecordingRequested ? <div style={sectionHintStyle} role="status">在系统设置允许 EduPi，重启后开启控制。</div> : null}
      {error ? <div className="computer-use-error" role="alert">{error}</div> : null}
    </div>
  </div>;
}

function EduPiDataSettingsCard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<EduPiRootStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getEduPiRootStatusNative()
      .then((value) => { if (active) setStatus(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, []);

  const changeRoot = async () => {
    if (!status?.canChangeDataRoot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await selectDirectoryNative(status.dataRoot, t("appSettings.dataSelectTitle"));
      if (!selected) return;
      setStatus(await setEduPiDataRootNative(selected));
      await relaunchAppNative();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetRoot = async () => {
    if (!status?.canChangeDataRoot || busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await resetEduPiDataRootNative());
      await relaunchAppNative();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div className="native-settings-card app-settings-data" data-setting-id="data-root" tabIndex={-1} style={sectionCardStyle}>
    <div className="app-settings-row">
      <div className="app-settings-row__label"><span>数据目录</span><code title={status?.dataRoot}>{status?.dataRoot || "正在读取"}</code></div>
      <button type="button" className="native-button" disabled={!status?.canChangeDataRoot || busy} onClick={() => void changeRoot()}>{t("appSettings.dataChoose")}</button>
    </div>
    <details className="app-settings-help"><summary>目录选项</summary>
      <div className="app-settings-data__source">
        {t("appSettings.dataSource", { source: status ? t(`appSettings.dataSource.${status.dataSource}`) : "…" })}
        <span style={{ marginLeft: 10 }}>{t("appSettings.coreSource", { source: status ? t(`appSettings.coreSource.${status.coreSource}`) : "…" })}</span>
      </div>
      <button type="button" className="native-button" disabled={!status?.canChangeDataRoot || busy} onClick={() => void resetRoot()}>{t("appSettings.dataReset")}</button>
    </details>
      {status?.fallbackReason ? <div className="native-inline-alert is-error" role="status">{t("appSettings.dataFallback", { reason: status.fallbackReason })}</div> : null}
      {status && !status.canChangeDataRoot ? <div style={sectionHintStyle}>{t("appSettings.dataEnvironmentLocked")}</div> : null}
      {error ? <div className="native-inline-alert is-error" role="alert">{error}</div> : null}
  </div>;
}
function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="native-button"
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const metaChipStyle = (emphasized: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  maxWidth: "100%",
  padding: "6px 9px",
  border: `1px solid ${emphasized ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 7,
  background: emphasized
    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
    : "var(--bg)",
  color: emphasized ? "var(--accent)" : "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: emphasized ? 700 : 500,
  lineHeight: 1.35,
  textDecoration: "none",
});

function VersionChip({
  currentValue,
  latestValue,
  versionsMatch,
  updateAvailable,
  href,
  title,
  ariaLabel,
  versionLabel,
  currentLabel,
  latestLabel,
  upgradeAvailableLabel,
}: {
  currentValue: string;
  latestValue: string;
  versionsMatch: boolean;
  updateAvailable: boolean;
  href: string;
  title: string;
  ariaLabel: string;
  versionLabel: string;
  currentLabel: string;
  latestLabel: string;
  upgradeAvailableLabel: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={ariaLabel}
      style={metaChipStyle(updateAvailable)}
      onClick={(event) => handleExternalLinkClick(event, href)}
    >
      {versionsMatch ? (
        <>
          <span style={{ opacity: 0.72, fontWeight: 500 }}>{versionLabel}</span>
          <span>{currentValue}</span>
        </>
      ) : (
        <>
          <span style={{ opacity: 0.72, fontWeight: 500 }}>{currentLabel}</span>
          <span>{currentValue}</span>
          <span aria-hidden="true" style={{ width: 1, height: 13, background: "currentColor", opacity: 0.2 }} />
          <span style={{ opacity: updateAvailable ? 0.9 : 0.72, fontWeight: 500 }}>{latestLabel}</span>
          <span style={{ color: updateAvailable ? "var(--accent)" : undefined, fontWeight: updateAvailable ? 800 : undefined }}>
            {latestValue}
          </span>
          {updateAvailable ? (
            <span
              style={{
                padding: "1px 5px",
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--bg-panel)",
                fontSize: 9,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {upgradeAvailableLabel}
            </span>
          ) : null}
        </>
      )}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function AppSettings({ onClose, initialSection = null, embedded = false, page, onUpgradeInProgressChange }: { onClose: () => void; initialSection?: "mobile" | null; embedded?: boolean; page?: AppSettingsPage; onUpgradeInProgressChange?: (busy: boolean) => void }) {
  const { t, locale, setLocale, supportedLocales } = useI18n();
  const { theme, setTheme } = useTheme();
  const desktop = isTauriDesktop();
  const currentPage = page ?? (initialSection === "mobile" ? "devices" : "general");
  const [visitedPages, setVisitedPages] = useState<AppSettingsPage[]>(() => [currentPage]);
  const showsPage = (target: AppSettingsPage) => !embedded || currentPage === target || visitedPages.includes(target);
  const showNotifications = !embedded || currentPage === "notifications";
  const showUpdates = !embedded || currentPage === "about";
  const [components, setComponents] = useState<AppComponentReleaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upgradeProgress, setUpgradeProgress] = useState<DesktopUpgradeProgress | null>(null);
  const [upgradePreflightOpen, setUpgradePreflightOpen] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeErrorDetails, setUpgradeErrorDetails] = useState<ReturnType<typeof desktopUpgradeErrorDetails> | null>(null);
  const [closeQuits, setCloseQuits] = useState(() => getPrefBool(APP_PREF_KEYS.closeQuits, false));
  const [notifyOnComplete, setNotifyOnComplete] = useState(() => getPrefBool(APP_PREF_KEYS.notifyOnComplete, true));
  const [notificationTest, setNotificationTest] = useState("");
  const [testingNotification, setTestingNotification] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermissionStatus | null>(null);
  const updateCheckSequenceRef = useRef(0);

  useEffect(() => {
    setVisitedPages((current) => current.includes(currentPage) ? current : [...current, currentPage]);
  }, [currentPage]);

  useEffect(() => { onUpgradeInProgressChange?.(Boolean(upgradeProgress)); }, [onUpgradeInProgressChange, upgradeProgress]);
  useEffect(() => () => onUpgradeInProgressChange?.(false), [onUpgradeInProgressChange]);

  const refreshNotificationStatus = useCallback(async () => {
    if (!desktop) return;
    try {
      setNotificationStatus(await getNotificationPermissionStatusNative());
    } catch {
      setNotificationStatus(null);
    }
  }, [desktop]);

  useEffect(() => {
    if (!showNotifications) return;
    void refreshNotificationStatus();
  }, [refreshNotificationStatus, showNotifications]);

  const checkForUpdates = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++updateCheckSequenceRef.current;
    const isCurrent = () => requestId === updateCheckSequenceRef.current && !signal?.aborted;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/updates?refresh=1", { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as AppUpdatesResponse;
      if (!isCurrent()) return;
      setComponents(Array.isArray(data.components) ? data.components : []);
      setLoadError(hasAppUpdateCheckError(data, "edupi-desktop") ? "checkFailed" : null);
    } catch (error) {
      if (!isCurrent() || (error instanceof DOMException && error.name === "AbortError")) return;
      setLoadError("checkFailed");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showUpdates) return;
    const controller = new AbortController();
    void checkForUpdates(controller.signal);
    return () => controller.abort();
  }, [checkForUpdates, showUpdates]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !upgradeProgress && !embedded) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [embedded, onClose, upgradeProgress]);

  useEffect(() => {
    if (initialSection !== "mobile") return;
    if (embedded && currentPage !== "devices") return;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        document.getElementById("mobile-bridge-settings")?.scrollIntoView({ block: "center" });
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [currentPage, embedded, initialSection]);

  const appRelease = useMemo(
    () => components.find((component) => component.project === "edupi-desktop"),
    [components],
  );
  const pendingUpdates = useMemo(
    () => components.filter((component) => component.updateAvailable),
    [components],
  );
  const updateAvailable = pendingUpdates.length > 0;
  const notificationAuthorized = notificationStatus?.authorizationStatus !== undefined
    && notificationStatus.authorizationStatus >= 2;
  const canUpgrade = desktop && !loading && updateAvailable && !upgradeProgress;
  const downloadPercent = upgradeProgress?.phase === "downloading"
    && upgradeProgress.totalBytes
    ? Math.min(100, Math.round((upgradeProgress.downloadedBytes ?? 0) / upgradeProgress.totalBytes * 100))
    : null;
  const upgradeLabel = upgradeProgress?.phase === "checking"
    ? t("appSettings.preparing")
    : upgradeProgress?.phase === "downloading"
      ? (downloadPercent === null
        ? t("appSettings.downloading")
        : t("appSettings.downloadingPercent", { percent: downloadPercent }))
      : upgradeProgress?.phase === "verifying"
        ? t("appSettings.verifying")
      : upgradeProgress?.phase === "installing"
        ? t("appSettings.installing")
        : t("appSettings.update");

  const latestReleaseText = loading
    ? "…"
    : loadError
      ? t("appSettings.checkFailed")
      : !appRelease || appRelease.releaseStatus === "unknown"
        ? t("appSettings.releaseUnavailable")
        : appRelease.releaseStatus === "unpublished" || !appRelease.latestVersion
          ? t("appSettings.noReleases")
          : `v${appRelease.latestVersion}`;

  const statusText = loading
    ? t("appSettings.checkingReleases")
    : loadError
      ? t("appSettings.checkFailed")
      : updateAvailable
        ? t("appSettings.updateAvailable")
        : t("appSettings.upToDate");

  const currentVersion = appRelease?.currentVersion ?? APP_VERSION;
  const currentVersionText = `v${currentVersion === APP_VERSION ? APP_VERSION_DISPLAY : currentVersion}`;
  const versionsMatch = Boolean(
    appRelease?.latestVersion
      && compareAppVersions(currentVersion, appRelease.latestVersion) === 0,
  );
  const versionAriaLabel = versionsMatch
    ? `${t("appSettings.version")}: ${currentVersionText}. ${statusText}`
    : `${t("appSettings.currentVersion")}: ${currentVersionText}. ${t("appSettings.latestRelease")}: ${latestReleaseText}. ${statusText}`;

  const handleUpgrade = async (confirmed = false) => {
    if (!canUpgrade) return;
    if (!confirmed) { setUpgradePreflightOpen(true); return; }
    setUpgradePreflightOpen(false);
    setUpgradeError(null);
    setUpgradeErrorDetails(null);
    try {
      const result = await installLatestDesktopRelease(setUpgradeProgress);
      if (!result.installed) {
        setUpgradeProgress(null);
        setUpgradeError(t("appSettings.noSignedBundle", { name: APP_DISTRIBUTION_NAME }));
      }
    } catch (error) {
      setUpgradeProgress(null);
      const kind = desktopUpgradeErrorKind(error) as DesktopUpgradeErrorStage;
      setUpgradeError(t(
        kind === "manifest"
          ? "appSettings.manifestFailed"
          : kind === "download"
            ? "appSettings.downloadFailed"
            : kind === "signature"
              ? "appSettings.signatureFailed"
              : kind === "install"
                ? "appSettings.installFailed"
                : "appSettings.updateFailed",
      ));
      setUpgradeErrorDetails(desktopUpgradeErrorDetails(error));
    }
  };

  const content = <>
    <header className="app-settings-header">
      <div className="app-settings-header__main">
        {embedded ? <h1 id="app-settings-title">{PAGE_TITLES[currentPage]}</h1> : <h2 className="native-modal-title" id="app-settings-title">设置</h2>}
      </div>
      {!embedded ? <button className="native-modal-close" type="button" onClick={onClose} disabled={Boolean(upgradeProgress)} aria-label={t("appSettings.close")} title={t("appSettings.close")}>×</button> : null}
    </header>

    <div className="app-settings-body">
      {showsPage("general") ? <section className="app-settings-group" aria-label="常规" hidden={embedded && currentPage !== "general"}>
        {!embedded ? <h2>常规</h2> : null}
        <SettingsRow id="language" label={t("appSettings.languageSection")}>
          <div className="app-settings-choices" role="group" aria-label={t("appSettings.languageSection")}>
            {supportedLocales.map((plugin) => <ChoiceButton key={plugin.id} active={locale === plugin.id} onClick={() => setLocale(plugin.id as typeof locale)}>{plugin.label}</ChoiceButton>)}
          </div>
        </SettingsRow>
        <SettingsRow id="appearance" label={t("appSettings.appearanceSection")}>
          <div className="app-settings-choices" role="group" aria-label={t("appSettings.appearanceSection")}>
            <ChoiceButton active={theme === "light"} onClick={() => setTheme("light")}>{t("appSettings.themeLight")}</ChoiceButton>
            <ChoiceButton active={theme === "dark"} onClick={() => setTheme("dark")}>{t("appSettings.themeDark")}</ChoiceButton>
          </div>
        </SettingsRow>
        <ForegroundSettingsCard />
        {desktop ? <SettingsToggleRow id="window-close" label={t("appSettings.closeQuits")} hint={t("appSettings.closeQuitsHint")} checked={closeQuits} onChange={(next) => {
          setCloseQuits(next);
          setPrefBool(APP_PREF_KEYS.closeQuits, next);
          void setCloseQuitsNative(next);
        }} /> : null}
      </section> : null}

      {showsPage("profile") ? <section className="app-settings-group" aria-label="教师信息" hidden={embedded && currentPage !== "profile"}>
        {!embedded ? <h2>教师信息</h2> : null}
        <TeacherContextSettingsCard disabled={Boolean(upgradeProgress)} />
      </section> : null}

      {desktop && showsPage("notifications") ? <section className="app-settings-group" aria-label="通知" hidden={embedded && currentPage !== "notifications"}>
        {!embedded ? <h2>通知</h2> : null}
        <SettingsToggleRow id="completion-notifications" label={t("appSettings.notifyOnComplete")} hint="窗口在后台时发送。" checked={notifyOnComplete} onChange={(next) => {
          setNotifyOnComplete(next);
          setPrefBool(APP_PREF_KEYS.notifyOnComplete, next);
        }} />
        <SettingsRow id="notification-permission" label="系统通知">
          <span className={notificationAuthorized ? "app-settings-state is-ready" : "app-settings-state"} aria-live="polite">{notificationStatusLabel(notificationStatus)}</span>
          <button type="button" className="native-button" disabled={testingNotification || !notifyOnComplete} onClick={async () => {
            setTestingNotification(true);
            setNotificationTest("");
            try {
              await testDesktopNotification();
              await refreshNotificationStatus();
              setNotificationTest("系统已接受通知；点击通知应打开提醒");
            } catch (error) {
              await refreshNotificationStatus();
              setNotificationTest(error instanceof Error ? error.message : "通知测试失败");
            } finally { setTestingNotification(false); }
          }}>{testingNotification ? "发送中…" : "测试通知跳转"}</button>
        </SettingsRow>
        {notificationTest ? <p className="app-settings-feedback" role="status">{notificationTest}</p> : null}
      </section> : null}

      {desktop && showsPage("devices") ? <section className="app-settings-group" aria-label="设备与权限" hidden={embedded && currentPage !== "devices"}>
        {!embedded ? <h2>设备与权限</h2> : null}
        <ComputerUseSettingsCard />
        <div data-setting-id="mobile" tabIndex={-1}><MobileBridgeSettingsCard /></div>
      </section> : null}

      {desktop && showsPage("data") ? <section className="app-settings-group" aria-label="数据与隐私" hidden={embedded && currentPage !== "data"}>
        {!embedded ? <h2>数据与隐私</h2> : null}
        <EduPiDataSettingsCard />
        <div data-setting-id="usage" tabIndex={-1}><EduPiUsageSettingsCard /></div>
      </section> : null}

      {showsPage("about") ? <section className="app-settings-group" aria-label="关于与更新" hidden={embedded && currentPage !== "about"}>
        {!embedded ? <h2>关于与更新</h2> : null}
        <div className="app-settings-update" data-setting-id="updates" tabIndex={-1}>
          <div className="app-settings-row">
            <div className="app-settings-row__label"><strong>EduPi</strong><small aria-live="polite">{statusText}</small></div>
            <div className="app-settings-row__control">
              <button className="native-button" type="button" disabled={loading || Boolean(upgradeProgress)} onClick={() => void checkForUpdates()}>{loading ? t("appSettings.checking") : t("appSettings.checkUpdates")}</button>
              {desktop && (updateAvailable || upgradeProgress) ? <button className="native-button native-button-primary" type="button" disabled={!canUpgrade} onClick={() => void handleUpgrade()} title={t("appSettings.updateNote", { name: APP_DISTRIBUTION_NAME })}>{upgradeLabel}</button> : null}
            </div>
          </div>
          <VersionChip currentValue={currentVersionText} latestValue={latestReleaseText} versionsMatch={versionsMatch} updateAvailable={updateAvailable} href={appRelease?.releaseUrl ?? APP_RELEASES_URL} title={statusText} ariaLabel={versionAriaLabel} versionLabel={t("appSettings.version")} currentLabel={t("appSettings.currentVersion")} latestLabel={t("appSettings.latestRelease")} upgradeAvailableLabel={t("appSettings.upgradeAvailable")} />
          {upgradePreflightOpen ? <div className="settings-update-preflight" role="group" aria-label="安装前确认"><p>更新需要替换当前应用并重启，请先保存正在进行的工作。macOS 可能要求“App 管理”授权；该权限由系统核对，EduPi 不会自动打开开关。</p><div><button type="button" className="native-button" onClick={() => setUpgradePreflightOpen(false)}>取消</button><button type="button" className="native-button native-button-primary" onClick={() => void handleUpgrade(true)}>继续更新</button></div></div> : null}
          {upgradeError ? <div className="native-inline-alert is-error app-settings-feedback" role="alert">
            <div>{upgradeError}</div>
            {upgradeErrorDetails ? <details className="app-settings-update__diagnostics">
              <summary>{t("appSettings.updateDiagnostics")}</summary>
              <dl>
                <div><dt>{t("appSettings.updateStage")}</dt><dd>{t(`appSettings.updateStage.${upgradeErrorDetails.stage}`)}</dd></div>
                <div><dt>{t("appSettings.updateHost")}</dt><dd>{upgradeErrorDetails.host}</dd></div>
                <div><dt>{t("appSettings.updateRetries")}</dt><dd>{upgradeErrorDetails.retryCount}</dd></div>
                <div><dt>{t("appSettings.updateErrorCode")}</dt><dd>{upgradeErrorDetails.errorCode}</dd></div>
              </dl>
            </details> : null}
          </div> : null}
        </div>
        {desktop ? <>
          <div data-setting-id="update-proxy" tabIndex={-1}><UpdateProxySettingsCard onSaved={() => void checkForUpdates()} /></div>
          <div className="app-settings-actions app-settings-quit"><button type="button" className="native-button" onClick={() => void quitAppNative()}>{t("appSettings.quitApp")}</button></div>
        </> : null}
      </section> : null}
    </div>
  </>;

  if (embedded) return <div className="app-settings-page" data-page={currentPage} aria-labelledby="app-settings-title">{content}</div>;
  return <div className="native-modal-backdrop app-settings-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !upgradeProgress) onClose();
  }}><section className="native-modal app-settings-modal" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">{content}</section></div>;
}
