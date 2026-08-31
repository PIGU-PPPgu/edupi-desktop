export function materialInboxPathForCwd(cwd: string | null): string | null {
  return cwd ? `${cwd}/.edupi/inbox/teacher-materials` : null;
}
