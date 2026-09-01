import type { EducationContract, EducationEntityDeleteKind } from "./edupi-education-contract";

export async function deleteEducationEntity(kind: EducationEntityDeleteKind, id: string, note: string | null = null): Promise<{ target: { kind: EducationEntityDeleteKind; id: string }; deletedAt: string | null; data: EducationContract }> {
  const response = await fetch(`/api/edupi/entities/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const result = await response.json() as { error?: string; code?: string; target?: { kind: EducationEntityDeleteKind; id: string }; deletedAt?: string | null; data?: EducationContract };
  if (!response.ok || !result.target || !result.data) throw new Error(result.error || `删除失败（HTTP ${response.status}）`);
  return { target: result.target, deletedAt: result.deletedAt ?? null, data: result.data };
}
