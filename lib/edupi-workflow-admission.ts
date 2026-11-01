/** Internal child prompts may inherit only an active Core-captured parent turn. */
export function workflowChildPromptAllowed(
  gate: "allowed" | "core_first_required" | "unavailable",
  markedInternalChild: boolean,
  parentCaptureActive: boolean,
): boolean {
  return gate === "allowed" || markedInternalChild && parentCaptureActive;
}

export function matchingCapturedUserEntry(
  captured: boolean,
  running: boolean,
  sourceEntryId: string,
  branch: readonly { type: string; id: string; message?: { role?: string } }[],
): boolean {
  if (!captured || !running) return false;
  const user = [...branch].reverse().find(entry => entry.type === "message" && entry.message?.role === "user");
  return user?.id === sourceEntryId;
}
