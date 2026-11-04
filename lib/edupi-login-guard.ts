import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** One teacher request may start one action or inspect one Zhixue status. */
export function createZhixueLoginGuard(): ExtensionFactory {
  return (pi) => {
    const startedForUserEntries = new Set<string>();
    pi.on("tool_call", (event, ctx) => {
      const statusRead = event.toolName === "zhixue_login_status" || event.toolName === "zhixue_sync_status";
      if (!statusRead && event.toolName !== "zhixue_login" && event.toolName !== "zhixue_sync") return;
      const userEntry = [...ctx.sessionManager.getBranch()].reverse().find((entry) =>
        entry.type === "message" && entry.message.role === "user");
      const key = `${statusRead ? "zhixue_status" : event.toolName}:${userEntry?.id ?? "no-user-entry"}`;
      if (startedForUserEntries.has(key)) {
        return { block: true, reason: statusRead
          ? "本条请求已读过智学网状态。停止查询并告诉老师当前结论；需要扫码时只调用一次 zhixue_login，展示二维码后等待老师操作。"
          : event.toolName === "zhixue_login"
          ? "本条请求已尝试一次智学网扫码。请核对首次结果并告知老师，不要再次弹窗。"
          : "本条请求已尝试一次智学网同步。请核对首次状态，不要再次启动同步。" };
      }
      startedForUserEntries.add(key);
    });
  };
}
