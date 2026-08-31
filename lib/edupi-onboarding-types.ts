export type TeacherRole = "subject_teacher" | "homeroom_teacher" | "grade_group" | "academic_admin";

export type TeacherContextDraft = {
  name: string;
  subject: string;
  grade: string;
  school: string;
  isHomeroom?: boolean;
  roles: TeacherRole[];
  classes: string[];
  classCount?: number | null;
  studentCount?: number | null;
  painPoint?: string;
};

export type OnboardingChecklistItem = {
  id: "identity" | "calendar" | "timetable" | "roster" | "material";
  label: string;
  status: "complete" | "next" | "optional";
  description: string;
};

export type TeacherContextSnapshot = TeacherContextDraft & {
  configured: boolean;
  checklist: OnboardingChecklistItem[];
  memoryDirectory: string;
  editable: false;
  editReason: string;
};

export type EducationWorkspace = {
  id: string;
  label: string;
  school: string;
  grade: string;
  subject: string;
  updatedAt: string | null;
};
