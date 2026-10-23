import type { ComputerUseHostIdentity, ComputerUseStatus } from "./edupi-computer-use";

export type ComputerUsePermission = "accessibility" | "screen_recording";

export function computerUsePermissionLabel(value: boolean | null | undefined, requested = false): string {
  if (value === undefined) return "未检测";
  if (value === null) return "无法检测";
  if (value) return "已授权";
  return requested ? "待系统确认或重启" : "未授权";
}

export function computerUseHostLabel(host: ComputerUseHostIdentity | undefined): string {
  return host ? `${host.appName} · v${host.appVersion}` : "应用身份未检测";
}

export type ComputerUsePermissionFlow = {
  permission: ComputerUsePermission;
  screenRecordingRequested: boolean;
};

export function computerUseHostSessionKey(host: ComputerUseHostIdentity | undefined): string | null {
  if (!host || !Number.isSafeInteger(host.processId) || host.processId <= 0
    || typeof host.appVersion !== "string" || !host.appVersion.trim()
    || typeof host.bundleId !== "string" || !host.bundleId.trim()
    || typeof host.platform !== "string" || !host.platform.trim()
    || !(typeof host.bundlePath === "string" && host.bundlePath.trim()
      || typeof host.executablePath === "string" && host.executablePath.trim())) return null;
  return JSON.stringify([host.processId, host.appVersion, host.platform, host.bundleId, host.bundlePath, host.executablePath]);
}

/** Request progress only: this window's memory never stores a permission grant. */
export function createComputerUsePermissionFlowSession() {
  let pending: { hostKey: string; flow: ComputerUsePermissionFlow } | null = null;
  const cancellationListeners = new Set<() => void>();
  const read = (status: ComputerUseStatus): ComputerUsePermissionFlow | null => {
    const hostKey = computerUseHostSessionKey(status.host);
    if (!hostKey || pending?.hostKey !== hostKey
      || typeof status.accessibility !== "boolean" || typeof status.screenRecording !== "boolean") {
      pending = null;
      return null;
    }
    const flow = computerUsePermissionFlowAfterStatus(status, pending.flow);
    pending = flow ? { hostKey, flow } : null;
    return flow;
  };
  return {
    read,
    peek(status: ComputerUseStatus) {
      const hostKey = computerUseHostSessionKey(status.host);
      return hostKey && pending?.hostKey === hostKey
        && typeof status.accessibility === "boolean" && typeof status.screenRecording === "boolean"
        ? computerUsePermissionFlowAfterStatus(status, pending.flow) : null;
    },
    remember(status: ComputerUseStatus, flow: ComputerUsePermissionFlow | null) {
      const hostKey = computerUseHostSessionKey(status.host);
      pending = hostKey && flow ? { hostKey, flow: { ...flow } } : null;
      return read(status);
    },
    cancel(status: ComputerUseStatus, flow: ComputerUsePermissionFlow | null) {
      if (flow && pending?.hostKey === computerUseHostSessionKey(status.host) && pending.flow === flow) {
        pending = null;
        cancellationListeners.forEach(listener => listener());
      }
    },
    subscribeToCancellation(listener: () => void) {
      cancellationListeners.add(listener);
      return () => { cancellationListeners.delete(listener); };
    },
  };
}

/** A read can replace UI state without cancelling the latest native control receipt. */
export function createComputerUseControlMutationSession() {
  let sequence = 0;
  let observedHostKey: string | null = null;
  let pending: { sequence: number; enabled: boolean } | null = null;
  type Ticket = { sequence: number; hostKey: string };
  return {
    observe(status: ComputerUseStatus) {
      const hostKey = computerUseHostSessionKey(status.host);
      if (hostKey && hostKey !== observedHostKey) {
        observedHostKey = hostKey;
        sequence++;
        pending = null;
      }
    },
    begin(status: ComputerUseStatus | null, enabled: boolean): Ticket | null {
      const hostKey = computerUseHostSessionKey(status?.host);
      if (!hostKey || hostKey !== observedHostKey) return null;
      const ticket = { sequence: ++sequence, hostKey };
      pending = { sequence: ticket.sequence, enabled };
      return ticket;
    },
    isCurrent(ticket: Ticket, status?: ComputerUseStatus) {
      return ticket.sequence === sequence && ticket.hostKey === observedHostKey
        && (!status || computerUseHostSessionKey(status.host) === ticket.hostKey);
    },
    finish(ticket: Ticket) {
      if (pending?.sequence === ticket.sequence) pending = null;
    },
    acceptChange(enabled: boolean) {
      if (enabled && pending?.enabled === false) return { accepted: false, controlPending: true };
      if (!enabled && pending?.enabled === true) {
        sequence++;
        pending = null;
      }
      return { accepted: true, controlPending: pending !== null };
    },
  };
}

export const computerUseControlSession = createComputerUseControlMutationSession();

export type ComputerUsePrimaryAction =
  | { kind: "detect" }
  | { kind: "request"; permission: ComputerUsePermission }
  | { kind: "restart" }
  | { kind: "enable" }
  | { kind: "stop" };

export function nextMissingComputerUsePermission(status: {
  accessibility: boolean | null;
  screenRecording: boolean | null;
}): ComputerUsePermission | null {
  if (status.accessibility === false) return "accessibility";
  if (status.screenRecording === false) return "screen_recording";
  return null;
}

export function computerUsePermissionFlowAfterStatus(
  status: {
    accessibility: boolean | null;
    screenRecording: boolean | null;
  },
  flow: ComputerUsePermissionFlow | null,
): ComputerUsePermissionFlow | null {
  if (!flow) return null;
  if (flow.permission === "accessibility") {
    if (status.accessibility === false) return flow;
    if (status.screenRecording === false) {
      return { permission: "screen_recording", screenRecordingRequested: false };
    }
    return null;
  }
  return status.screenRecording === false ? flow : null;
}

export function computerUsePrimaryAction(options: {
  status: {
    enabled: boolean;
    accessibility: boolean | null;
    screenRecording: boolean | null;
  } | null;
  flow: ComputerUsePermissionFlow | null;
}): ComputerUsePrimaryAction {
  const { status, flow } = options;
  if (!status) return { kind: "detect" };

  const missing = nextMissingComputerUsePermission(status);
  if (missing) {
    if (flow?.permission === missing) {
      if (missing === "screen_recording" && flow.screenRecordingRequested) {
        return { kind: "restart" };
      }
      return { kind: "request", permission: missing };
    }
    return { kind: "request", permission: missing };
  }
  return status.enabled ? { kind: "stop" } : { kind: "enable" };
}

export function computerUsePrimaryActionLabel(action: ComputerUsePrimaryAction): string {
  switch (action.kind) {
    case "detect":
      return "检测权限";
    case "request":
      return "申请权限";
    case "restart":
      return "授权后重启";
    case "enable":
      return "开启控制";
    case "stop":
      return "停止控制";
  }
}
