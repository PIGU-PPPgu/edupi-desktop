// A G1 proof may perform three serial one-shot reads of the pinned Core.
// Each transport stays bounded below the two-minute notification claim lease.
export const NOTIFICATION_CORE_READ_DEADLINE_MS = 6_000;
export const NOTIFICATION_PROOF_DEADLINE_MS = 21_000;
export const NOTIFICATION_PROOF_TRANSPORT_DEADLINE_MS = 23_000;
