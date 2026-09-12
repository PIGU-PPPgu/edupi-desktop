import { NextResponse } from "next/server";
import { EduPiCoreProcessError } from "@/lib/edupi-core-process-client";
import { EduPiSnapshotError, readEduPiCoreHealth, readEduPiEducationSnapshot, readEduPiKernelProjection, resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { loadEduPiCompatManifest } from "@/lib/edupi-bridge-manifest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const manifest = loadEduPiCompatManifest();
  const identity = { runtime: manifest.core_runtime, contract: manifest.contract_identities[0] };
  const expectedCompatibility = {
    coreCommit: identity.runtime.core_commit,
    componentManifestHash: identity.runtime.component_manifest_hash,
    contractVersion: identity.contract.contract_version,
    schemaHash: identity.contract.schema_hash,
    fixtureManifestHash: identity.contract.fixture_manifest_hash,
    supportedCommands: [...identity.contract.supported_commands],
    supportedProjections: [...identity.contract.supported_projections],
    unsupportedCommandReasons: { ...manifest.unsupported_command_reasons },
    unsupportedProjectionReasons: { ...manifest.unsupported_projection_reasons },
  };
  try {
    const summaryOnly = request ? new URL(request.url).searchParams.get("summary") === "1" : false;
    const roots = resolveEduPiBridgeRoots();
    const { health } = await readEduPiCoreHealth({ roots, requestId: `desktop-status-health-${Date.now().toString(36)}` });
    const [snapshot, kernel] = await Promise.all([
      readEduPiEducationSnapshot({ roots, requestId: `desktop-status-snapshot-${Date.now().toString(36)}` }),
      readEduPiKernelProjection({ roots, requestId: `desktop-status-kernel-${Date.now().toString(36)}` }),
    ]);
    const workspace = snapshot.workspace;
    const counts = {
      students: Array.isArray(workspace.students) ? workspace.students.length : 0,
      timetable: Array.isArray(workspace.timetable) ? workspace.timetable.length : 0,
      calendar: Array.isArray(workspace.calendar) ? workspace.calendar.length : 0,
      tasks: Array.isArray(workspace.tasks) ? workspace.tasks.length : 0,
    };
    const supportedCommands = Array.isArray(health.supported_commands) ? health.supported_commands : [];
    const supportedProjections = Array.isArray(health.supported_projections) ? health.supported_projections : [];
    const kernelBody = summaryOnly
      ? {
        status: "ready",
        projection_kind: kernel.projection.projection_kind,
        state_version: kernel.projection.state_version,
        updated_at: kernel.projection.updated_at,
        summary: kernel.projection.summary,
        runs: [],
      }
      : { status: "ready", ...kernel.projection };
    return NextResponse.json({
      scope: "teacher_internal",
      externalSend: false,
      requiresTeacherReview: true,
      core: {
        status: "ready",
        coreCommit: roots.runtime.coreCommit,
        validationMode: roots.runtime.validationMode,
        contractVersion: health.contract_version,
        schemaHash: health.schema_hash,
        componentManifestHash: roots.runtime.componentManifestHash,
        fixtureManifestHash: health.fixture_manifest_hash,
        supportedCommands,
        supportedProjections,
      },
      compatibility: { expected: expectedCompatibility, actual: { coreCommit: roots.runtime.coreCommit, componentManifestHash: roots.runtime.componentManifestHash, contractVersion: health.contract_version, schemaHash: health.schema_hash, fixtureManifestHash: health.fixture_manifest_hash, supportedCommands, supportedProjections } },
      projection: { status: "ready", reason: null, projection: "education_workspace", counts },
      kernel: kernelBody,
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
      compatibility: { expected: expectedCompatibility, actual: null, reason },
      projection: { status: "unavailable", reason: `${reason}；未使用本地 JSON 回退` },
      kernel: { status: "unavailable", summary: { total: 0, running: 0, failed: 0, needs_review: 0, succeeded: 0, skipped: 0 }, runs: [] },
    });
  }
}
