import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_runtime: { core_commit: "542d9f5ecff463b40e955778fa8af42a78b4ac8d"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:ea64a99cfaea87a1b3929c91a8635ace165d5beec854531d87533a9ae0c34fed" };
  contract_identities: Array<{ contract_id: "edupi-bridge-v1.1"; contract_version: "1.1"; schema_hash: "sha256:30d10113b6c7e7b2d3ad4eb54e34d47e8d03e848e9fbbabd1c81cf5db36727df"; fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json"; fixture_manifest_hash: "sha256:2143fe0c4ab271d251134f137304c9dbef0a1b33517d8e8159c8adfb6dcb43c4"; supported_commands: CoreCommandType[]; supported_projections: ["education_workspace"]; depends_on: string[] }>;
  cumulative_projection_manifest: null | Record<string, unknown>;
  supported_commands: CoreCommandType[];
  supported_projections: string[];
  unsupported_command_reasons: Record<Exclude<CoreCommandType, "review_observation" | "review_memory_candidate" | "review_teacher_context" | "review_work_candidate" | "review_task" | "import_calendar" | "import_timetable" | "intake_material" | "create_task" | "move_task_stage" | "update_memory">, string>;
  unsupported_projection_reasons: Record<string, string>;
  paired_prs: string[];
  change_note: string;
};

export function loadEduPiCompatManifest(): EduPiCompatManifest {
  const manifest = manifestJson as unknown as EduPiCompatManifest;
  if (manifest.compat_manifest_version !== "1.0" || manifest.core_repository !== "edupi") throw new Error("Invalid EduPi compatibility manifest");
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "201f7913f23e0b8a4cc94f9ad799995e8deb82b3" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:d1e52c814bebe723c1bd206adefe9d815e543c678e221cca0a3e8963cf6f32c7") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities[0];
  if (manifest.contract_identities.length !== 1 || identity.contract_id !== "edupi-bridge-v1.1" || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:30d10113b6c7e7b2d3ad4eb54e34d47e8d03e848e9fbbabd1c81cf5db36727df" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:2143fe0c4ab271d251134f137304c9dbef0a1b33517d8e8159c8adfb6dcb43c4") throw new Error("Invalid EduPi contract identities");
  const supportedCommands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"] as const;
  const hasExactCommands = (value: unknown): boolean => Array.isArray(value)
    && value.length === supportedCommands.length
    && value.every((command, index) => command === supportedCommands[index]);
  if (!hasExactCommands(manifest.supported_commands) || !hasExactCommands(identity.supported_commands)) throw new Error("EduPi C1 command capability identity is incomplete");
  if (manifest.supported_projections.length !== 1 || manifest.supported_projections[0] !== "education_workspace" || identity.supported_projections.length !== 1 || identity.supported_projections[0] !== "education_workspace") throw new Error("EduPi education projection identity is incomplete");
  const expectedUnsupportedCommands = BRIDGE_COMMAND_TYPES.filter((command) => !supportedCommands.includes(command as typeof supportedCommands[number]));
  if (Object.keys(manifest.unsupported_command_reasons).sort().join("|") !== [...expectedUnsupportedCommands].sort().join("|")) throw new Error("EduPi command reason set is incomplete");
  return manifest;
}

export function activeBridgeIdentity() {
  const manifest = loadEduPiCompatManifest();
  return { runtime: manifest.core_runtime, contract: manifest.contract_identities[0] };
}
