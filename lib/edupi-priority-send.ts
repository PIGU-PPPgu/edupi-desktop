type RunningState = {
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
};

/** Stop one run before sending through the ordinary durable prompt path. */
export async function interruptForPrioritySend<T>({ readState, abort, settle, stillCurrent, canAbort, send }: {
  readState: () => Promise<RunningState>;
  abort: () => Promise<void>;
  settle: () => Promise<void>;
  stillCurrent: () => boolean;
  canAbort?: () => boolean;
  send: () => Promise<T>;
}): Promise<T> {
  if (!stillCurrent()) throw new Error("会话已切换，消息未发送");
  if (canAbort && !canAbort()) throw new Error("当前消息仍在提交，请等回执确定后重试");
  const before = await readState();
  if (before.queuedMessages?.steering?.length || before.queuedMessages?.followUp?.length) {
    throw new Error("已有排队消息，请先召回后再打断发送");
  }
  if (!stillCurrent()) throw new Error("会话已切换，消息未发送");
  if (canAbort && !canAbort()) throw new Error("当前消息仍在提交，请等回执确定后重试");
  await abort();
  await settle();
  if (!stillCurrent()) throw new Error("会话已切换，消息未发送");
  const after = await readState();
  if (!stillCurrent()) throw new Error("会话已切换，消息未发送");
  if (after.queuedMessages?.steering?.length || after.queuedMessages?.followUp?.length) {
    throw new Error("当前处理留下排队消息，请先召回后再打断发送");
  }
  if (after.isStreaming || after.isPromptRunning || after.isBashRunning || after.isCompacting) {
    throw new Error("当前处理尚未停止，消息未发送");
  }
  return send();
}
