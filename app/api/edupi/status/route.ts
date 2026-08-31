import { NextResponse } from "next/server";
import { EduPiCoreProcessError } from "@/lib/edupi-core-process-client";
import { EduPiSnapshotError, readEduPiCoreHealth, readEduPiEducationSnapshot, resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const roots = resolveEduPiBridgeRoots();
    const { health } = await readEduPiCoreHealth({ roots, requestId: `desktop-status-health-${Date.now().toString(36)}` });
    const snapshot = await readEduPiEducationSnapshot({ roots, requestId: `desktop-status-snapshot-${Date.now().toString(36)}` });
    const workspace = snapshot.workspace;
    const counts = {
      students: Array.isArray(workspace.students) ? workspace.students.length : 0,
      timetable: Array.isArray(workspace.timetable) ? workspace.timetable.length : 0,
      calendar: Array.isArray(workspace.calendar) ? workspace.calendar.length : 0,
      tasks: Array.isArray(workspace.tasks) ? workspace.tasks.length : 0,
    };
    const supportedCommands = Array.isArray(health.supported_commands) ? health.supported_commands : [];
    const supportedProjections = Array.isArray(health.supported_projections) ? health.supported_projections : [];
    return NextResponse.json({
      scope: "teacher_internal",
      externalSend: false,
      requiresTeacherReview: true,
      core: {
        status: "ready",
        contractVersion: health.contract_version,
        schemaHash: health.schema_hash,
        componentManifestHash: roots.runtime.componentManifestHash,
        fixtureManifestHash: health.fixture_manifest_hash,
        supportedCommands,
        supportedProjections,
      },
      projection: { status: "ready", reason: null, projection: "education_workspace", counts },
    });
  } catch (error) {
    const reason = error instanceof EduPiCoreProcessError
      ? `Core 连接不可用（${error.code}）`
      : error instanceof EduPiSnapshotError
        ? `Core 教育投影不可用（${error.code}）`
        : "Core 连接不可用";
    return NextResponse.json({
      scope: "teacher_internal",
      externalSend: false,
      requiresTeacherReview: true,
      core: { status: "unavailable", reason, supportedCommands: [], supportedProjections: [] },
      projection: { status: "unavailable", reason: `${reason}；未使用本地 JSON 回退` },
    });
  }
}
