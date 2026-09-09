import type { CalendarFact } from "./edupi-education-contract";

export type PlanOverlapSuggestion = {
  id: string;
  kind: "duplicate" | "overlap";
  reason: string;
  left: CalendarFact;
  right: CalendarFact;
  status: "pending" | "merged" | "separate" | "ignored";
  merging?: boolean;
  keepId?: string;
};
export type PlanOverlapState = { version: string; needsScan: boolean; pairs: number; remaining?: number; suggestions: PlanOverlapSuggestion[]; error?: string };
export type PlanOverlapAction = { action: "scan" } | { action: "merge" | "keep_separate" | "ignore"; id: string; keepId?: string };
