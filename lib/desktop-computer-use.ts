import { isTauriDesktop } from "./desktop-updater";
import type { ComputerUseBridgeResult, ComputerUseInput, ComputerUseStatus, NativeComputerUseResult } from "./edupi-computer-use";

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriDesktop()) throw new Error("桌面控制只在 EduPi 桌面应用中可用");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function getComputerUseStatusNative(): Promise<ComputerUseStatus> {
  return invokeDesktop("computer_use_status");
}

export function setComputerUseEnabledNative(enabled: boolean): Promise<ComputerUseStatus> {
  return invokeDesktop("computer_use_set_enabled", { enabled });
}

export function emergencyStopComputerUseNative(): Promise<ComputerUseStatus> {
  return invokeDesktop("computer_use_emergency_stop");
}

export function requestComputerUsePermissionNative(permission: "accessibility" | "screen_recording"): Promise<ComputerUseStatus> {
  return invokeDesktop("computer_use_request_permission", { permission });
}

export function executeComputerUseNative(input: ComputerUseInput, expiresAtMs: number): Promise<NativeComputerUseResult> {
  return invokeDesktop("computer_use_execute", { input, expiresAtMs });
}

export async function runComputerUseFromAgent(input: ComputerUseInput, expiresAtMs?: number): Promise<ComputerUseBridgeResult> {
  try {
    if (expiresAtMs !== undefined && expiresAtMs < Date.now()) return { ok: false, error: "桌面控制请求已过期" };
    if (input.action === "status") {
      const status = await getComputerUseStatusNative();
      const permission = (value: boolean | null) => value === null ? "未知" : value ? "已授权" : "未授权";
      return {
        ok: true,
        result: {
          content: `桌面控制：${status.enabled ? "已开启" : "已关闭"}\n辅助功能：${permission(status.accessibility)}\n屏幕录制：${permission(status.screenRecording)}`,
          isError: false,
          images: [],
          snapshotId: null,
          operationId: "computer-status",
        },
      };
    }
    if (expiresAtMs === undefined) return { ok: false, error: "桌面控制请求缺少截止时间" };
    return { ok: true, result: await executeComputerUseNative(input, expiresAtMs) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
