import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";
import { EduPiTeacherTemplateError } from "./edupi-teacher-template-config";

/** Use the pinned Core's own read-only validator; selecting a template never migrates a teacher root. */
export async function assertTeacherTemplateStorage(
  { runtime, dataRoot }: { runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot }, rootRef: string,
): Promise<void> {
  const load = (name: string) => import(/* webpackIgnore: true */ pathToFileURL(path.join(runtime.root, "scripts", name)).href);
  try {
    const [{ prepareCoreRuntimeRoot }, { assertCoreRuntimeV4Storage }, { DatabaseSync }] = await Promise.all([
      load("core_runtime_root.mjs"), load("core_runtime_store.mjs"), import("node:sqlite"),
    ]);
    const root = prepareCoreRuntimeRoot(dataRoot.root);
    if (!root.ok || root.dataRootFingerprint !== rootRef || typeof assertCoreRuntimeV4Storage !== "function") {
      throw new Error("template_storage_unavailable");
    }
    const before = assertCoreRuntimeV4Storage(null, root, true);
    const database = new DatabaseSync(root.databasePath, { readOnly: true });
    try {
      const after = assertCoreRuntimeV4Storage(database, root, true);
      if (JSON.stringify(before.mainIdentity) !== JSON.stringify(after.mainIdentity)) throw new Error("template_storage_changed");
    } finally { database.close(); }
  } catch (error) {
    throw new EduPiTeacherTemplateError((error as { code?: string })?.code === "schema_mismatch"
      ? "teacher_template_runtime_upgrade_required" : "teacher_template_configuration_unavailable");
  }
}
