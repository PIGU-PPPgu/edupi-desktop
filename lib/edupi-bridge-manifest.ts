import manifestJson from "../contracts/edupi-core-compat.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_runtime: { core_commit: "4c9f9cb067952245902bc83d483fa2558ab25c27"; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: "sha256:1f15c9f08af0fa2db422d972c8b65394b4b95b19880a85929cad7d5020ca006c" };
  contract_identities: Array<{ contract_id: "edupi-bridge-v1.1"; contract_version: "1.1"; schema_hash: "sha256:a0916f90fbca72da0c48e545c5c8dfddee42a0f0b3e54641c7a2297e54e9eb31"; fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json"; fixture_manifest_hash: "sha256:68e9d2e91e04a314037590b1a5ebe51cf2fab3d50392d65e30a0dd71bec29cfb"; supported_commands: CoreCommandType[]; supported_projections: ["education_workspace"]; depends_on: string[] }>;
  cumulative_projection_manifest: null | Record<string, unknown>;
  supported_commands: CoreCommandType[];
  supported_projections: string[];
  unsupported_command_reasons: Record<Exclude<CoreCommandType, "review_observation" | "review_memory_candidate" | "review_teacher_context" | "review_work_candidate" | "review_task" | "import_calendar" | "import_timetable" | "intake_material" | "create_task" | "move_task_stage">, string>;
  unsupported_projection_reasons: Record<string, string>;
  paired_prs: string[];
  change_note: string;
};

export function loadEduPiCompatManifest(): EduPiCompatManifest {
  const manifest = manifestJson as unknown as EduPiCompatManifest;
  if (manifest.compat_manifest_version !== "1.0" || manifest.core_repository !== "edupi") throw new Error("Invalid EduPi compatibility manifest");
  if (!manifest.core_runtime || manifest.core_runtime.core_commit !== "4c9f9cb067952245902bc83d483fa2558ab25c27" || manifest.core_runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json" || manifest.core_runtime.component_manifest_hash !== "sha256:1f15c9f08af0fa2db422d972c8b65394b4b95b19880a85929cad7d5020ca006c") throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities[0];
  if (manifest.contract_identities.length !== 1 || identity.contract_id !== "edupi-bridge-v1.1" || identity.contract_version !== "1.1" || identity.schema_hash !== "sha256:a0916f90fbca72da0c48e545c5c8dfddee42a0f0b3e54641c7a2297e54e9eb31" || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== "sha256:68e9d2e91e04a314037590b1a5ebe51cf2fab3d50392d65e30a0dd71bec29cfb") throw new Error("Invalid EduPi contract identities");
  const supportedCommands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage"] as const;
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
