import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** A login attempt is a visible, long-lived browser window, not a repeatable read. */
export function createZhixueLoginGuard(): ExtensionFactory {
  return (pi) => {
    const startedForUserEntries = new Set<string>();
    pi.on("tool_call", (event, ctx) => {
      if (event.toolName !== "zhixue_login" && event.toolName !== "zhixue_sync") return;
      const userEntry = [...ctx.sessionManager.getBranch()].reverse().find((entry) =>
        entry.type === "message" && entry.message.role === "user");
      const key = `${event.toolName}:${userEntry?.id ?? "no-user-entry"}`;
      if (startedForUserEntries.has(key)) {
        return { block: true, reason: event.toolName === "zhixue_login"
          ? "本条请求已尝试一次智学网扫码。请核对首次结果并告知老师，不要再次弹窗。"
          : "本条请求已尝试一次智学网同步。请核对首次状态，不要再次启动同步。" };
      }
      startedForUserEntries.add(key);
    });
  };
}
