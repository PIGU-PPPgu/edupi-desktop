/** One asynchronous send preparation per composer; invalidation never clears a draft. */
export function createDraftSubmissionGate(timeoutMs = 15_000) {
  let revision = 0;
  let active: AbortController | null = null;
  return {
    invalidate() {
      revision++;
      active?.abort();
    },
    async run<T>(
      prepare: (signal: AbortSignal) => Promise<T>,
      commit: (value: T) => void,
      onError: () => void,
    ): Promise<void> {
      if (active) return;
      const controller = new AbortController();
      active = controller;
      const startedRevision = revision;
      const current = () => revision === startedRevision;
      let abortListener: (() => void) | undefined;
      const deadline = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const aborted = new Promise<never>((_, reject) => {
          abortListener = () => reject(new Error("draft_submission_aborted"));
          controller.signal.addEventListener("abort", abortListener, { once: true });
        });
        const result = await Promise.race([prepare(controller.signal), aborted]);
        if (current() && !controller.signal.aborted) commit(result);
      } catch {
        if (current()) onError();
      } finally {
        clearTimeout(deadline);
        if (abortListener) controller.signal.removeEventListener("abort", abortListener);
        if (active === controller) active = null;
      }
    },
  };
}
