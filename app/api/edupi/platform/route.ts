import { NextResponse } from "next/server";
import { callEduPiCore } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const roots = resolveEduPiBridgeRoots();
    const operations = ["teaching-skills", "connectors", "agent-computer", "platform"] as const;
    const responses = await Promise.all(operations.map((operation) => callEduPiCore<Record<string, unknown>>({ operation, requestId: `desktop-${operation}-${Date.now().toString(36)}`, runtime: roots.runtime, dataRoot: roots.dataRoot })));
    const expected = ["teaching_skill_lifecycle", "connector_registry", "persistent_agent_computer", "hosted_core_harness_registry"];
    if (responses.some((response, index) => response.ok !== true || (response.projection as { projection_kind?: unknown } | undefined)?.projection_kind !== expected[index])) throw new Error("platform projection mismatch");
    return NextResponse.json({ scope: "teacher_internal", externalSend: false, teachingSkills: responses[0].projection, connectors: responses[1].projection, agentComputer: responses[2].projection, platform: responses[3].projection });
  } catch {
    return NextResponse.json({ error: "EduPi 平台状态不可用" }, { status: 503 });
  }
}
