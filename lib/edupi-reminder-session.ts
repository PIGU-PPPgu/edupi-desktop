export async function bindReminderSession(taskId: string, sessionId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`/api/edupi/tasks/${encodeURIComponent(taskId)}/session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error("对话已保存，任务关联失败");
}
