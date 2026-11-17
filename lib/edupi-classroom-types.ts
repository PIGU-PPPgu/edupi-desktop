export type ClassroomDomain = "grades" | "seating" | "duty";
export type ClassroomStudent = { student_id: string; name: string; class_name: string; traits: string[] };
export type ClassroomIssue = { code: string; message: string; severity: "error" | "warning" };
export type GradeInput = {
  title: string; class_name: string; date: string;
  subjects: Array<{ name: string; max_score: number }>;
  rows: Array<{ row_id: string; name: string; student_id?: string; class_name?: string; scores: Record<string, number | null> }>;
  baseline_id?: string;
};
export type SeatingAssignment = { student_id: string; name?: string; row: number; column: number; group: number };
export type SeatingInput = {
  title: string; class_name: string; mode: "seating" | "groups"; rows: number; columns: number; group_size: number;
  student_ids: string[]; exam_id?: string;
  features: Record<string, { gender?: string; height?: number; front?: boolean; score?: number; activity?: number; self_control?: number; emotion?: number; leadership?: number }>;
  constraints: { gender_strategy: "ignore" | "mixed" | "same"; avoid_pairs: [string, string][]; fixed_seats: Array<{ student_id: string; row: number; column: number }> };
  assignments?: SeatingAssignment[];
};
export type DutyAssignment = { date: string; post_id: string; post_name?: string; student_ids: string[]; student_names?: string[] };
export type DutyInput = {
  title: string; class_name: string; start_date: string; days: number; weekdays: number[]; student_ids: string[]; exempt_ids: string[];
  posts: Array<{ id: string; name: string; count: number; weight: number; gender: "any" | "male" | "female" }>;
  max_per_day: number; max_days_per_week: number; assignments?: DutyAssignment[];
  features?: Record<string, { gender?: string }>;
  substitutions?: Array<{ date: string; post_id: string; from_id: string; to_id: string }>;
};
export type ClassroomInput = GradeInput | SeatingInput | DutyInput;
export type ClassroomResult = {
  subjects?: Array<{ name: string; count: number; missing: number; mean: number | null; median: number | null; min: number | null; max: number | null; stddev: number | null; pass_rate: number | null; excellent_rate: number | null }>;
  students?: Array<{ student_id: string; name: string; total: number | null; rank: number | null }>;
  comparison?: null | { baseline_id: string; baseline_revision: number; students: Array<{ student_id: string; name: string; before: number; after: number; delta: number | null; rank_delta: number; z_delta: number; value_added?: { score_value_added_rate: number } }> };
  assignments?: SeatingAssignment[] | DutyAssignment[];
  groups?: Array<{ id: number; student_ids: string[] }>;
  score?: number;
  workloads?: Array<{ student_id: string; name: string; count: number; weight: number }>;
  fairness_gap?: number;
};
export type ClassroomVersion = { revision: number; saved_at: string; action: string; restored_from: number | null };
export type ClassroomRecord = {
  id: string; domain: ClassroomDomain; revision: number; created_at: string; updated_at: string;
  input: ClassroomInput; result: ClassroomResult; issues: ClassroomIssue[]; versions: ClassroomVersion[]; task_id?: string;
  publication?: { task_id: string; source_revision: number; state: "pending" | "linked" };
};
export type ClassroomSummary = { id: string; domain: ClassroomDomain; title: string; class_name: string; revision: number; updated_at: string; date: string | null; mode: string | null; task_id: string | null };
export type ClassroomRequest = {
  domain: ClassroomDomain; action: "roster" | "list" | "read" | "preview" | "save" | "restore" | "publish";
  id?: string; expected_revision?: number; revision?: number; input?: ClassroomInput; request_id?: string;
};
export type ClassroomReply = {
  ok: true; operation: "classroom"; request_id: string; external_send: false;
  record?: ClassroomRecord; records?: ClassroomSummary[]; students?: ClassroomStudent[];
  input?: ClassroomInput; result?: ClassroomResult; issues?: ClassroomIssue[];
  unresolved?: Array<{ row_id: string; name: string; reason: string; candidates: ClassroomStudent[] }>;
};
