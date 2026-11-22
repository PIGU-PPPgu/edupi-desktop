/** Keep local session routes intact; cloud requests use an explicit adapter. */
export function cloudChatRoutePath(pathname: string): string | null {
  const match = /^\/api\/(sessions|agent)(\/.*)?$/u.exec(pathname);
  return match ? `/api/edupi/cloud/chat/${match[1]}${match[2] || ""}` : null;
}

/** Old cloud views must not mutate local sessions after a mode change. */
export function localChatWriteScopeMatches(expected: string | null, generation: number): boolean {
  return expected === null || expected === "local" || expected === JSON.stringify(["local", generation]);
}
