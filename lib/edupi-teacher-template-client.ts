import { fetchDesktopApi } from "./desktop-native";

export type TeacherTemplateSettings = {
  version: 1; status: "missing" | "ready" | "invalid" | "root_mismatch";
  enabled: boolean; scope: { class_id: string; subject: string } | null; selectedCount: number; updatedAt: string | null;
};
export type TeacherTemplateStop = {
  version: 1; enabled: false; updatedAt: string;
  localStatus: "disabled" | "superseded" | "unknown";
  runtimeStatus: "verified" | "unknown"; coreStatus: "paused" | "revoked" | "missing" | "unknown";
};
export async function readTeacherTemplateSettings(signal?: AbortSignal): Promise<TeacherTemplateSettings> {
  const response = await fetchDesktopApi("/api/edupi/teacher-templates", { cache: "no-store", signal });
  const value = await response.json();
  if (!response.ok || value?.version !== 1 || !["missing", "ready", "invalid", "root_mismatch"].includes(value.status)
    || typeof value.enabled !== "boolean" || !Number.isInteger(value.selectedCount) || value.selectedCount < 0 || value.selectedCount > 40
    || value.updatedAt !== null && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)))
    || value.scope !== null && (!value.scope || typeof value.scope.class_id !== "string" || typeof value.scope.subject !== "string")) {
    throw new Error("周期材料设置暂不可用。");
  }
  return value;
}
export async function stopTeacherTemplateAutomation(expectedUpdatedAt: string | null): Promise<TeacherTemplateStop> {
  const response = await fetchDesktopApi("/api/edupi/teacher-templates", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false, expectedUpdatedAt }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "周期材料停止状态暂不可用。");
  if (value?.version !== 1 || value.enabled !== false || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || !["disabled", "superseded", "unknown"].includes(value.localStatus)
    || !["verified", "unknown"].includes(value.runtimeStatus)
    || !["paused", "revoked", "missing", "unknown"].includes(value.coreStatus)) throw new Error("周期材料停止回执无效。");
  return value;
}
