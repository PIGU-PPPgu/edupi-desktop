import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** One teacher request may start one action or inspect one Zhixue status. */
export function createZhixueLoginGuard(): ExtensionFactory {
  return (pi) => {
    const startedForUserEntries = new Set<string>();
    const repeatedStatusReads = new Map<string, number>();
    pi.on("tool_call", (event, ctx) => {
      const statusRead = event.toolName === "zhixue_login_status" || event.toolName === "zhixue_sync_status";
      if (!statusRead && event.toolName !== "zhixue_login" && event.toolName !== "zhixue_sync") return;
      const userEntry = [...ctx.sessionManager.getBranch()].reverse().find((entry) =>
        entry.type === "message" && entry.message.role === "user");
      const key = `${event.toolName}:${userEntry?.id ?? "no-user-entry"}`;
      if (startedForUserEntries.has(key)) {
        if (statusRead) {
          const duplicateCount = repeatedStatusReads.get(key) ?? 0;
          repeatedStatusReads.set(key, duplicateCount + 1);
          return {
            block: true,
            terminate: duplicateCount >= 1,
            reason: duplicateCount === 0
              ? "本条请求刚刚已经读过智学网状态。请直接根据上一次结果告诉老师当前结论，不要再次查询。"
              : "本条请求已重复读取智学网状态。停止查询并告诉老师当前结论；需要扫码时只调用一次 zhixue_login，展示二维码后等待老师操作。",
          };
        }
        return { block: true, terminate: true, reason: event.toolName === "zhixue_login"
          ? "本条请求已尝试一次智学网扫码。请核对首次结果并告知老师，不要再次弹窗。"
          : "本条请求已尝试一次智学网同步。请核对首次状态，不要再次启动同步。" };
      }
      startedForUserEntries.add(key);
    });
  };
}
