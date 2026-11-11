import manifestJson from "../contracts/edupi-core-compat.json";
import crypto from "node:crypto";
import bridgeSchema from "../contracts/edupi-bridge-v1.1.schema.json";
import occurrenceHash from "../contracts/edupi-schedule-occurrence-v1.2-hash.json";
import fixtureManifest from "../fixtures/bridge/v1.1/fixture-manifest.json";
import { BRIDGE_COMMAND_TYPES, type CoreCommandType } from "./edupi-bridge-contract";

export type EduPiBridgeContractIdentity = {
  contract_id: "edupi-bridge-v1.1";
  contract_version: "1.1";
  schema_hash: string;
  fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json";
  fixture_manifest_hash: string;
  supported_commands: CoreCommandType[];
  supported_projections: ["education_workspace"];
  depends_on: [];
};

export type ScheduleOccurrenceContractIdentity = {
  contract_id: "edupi-schedule-occurrence-v1.2";
  contract_version: "1.2";
  schema_path: "contracts/edupi-schedule-occurrence-v1.2.schema.json";
  schema_hash: string;
  supported_commands: ["import_calendar"];
  supported_projections: ["schedule_occurrence"];
  depends_on: ["edupi-bridge-v1.1"];
};

export type EduPiCompatManifest = {
  compat_manifest_version: "1.0";
  core_repository: "edupi";
  core_sdk: { pi: "1.0.2"; pi_durable: "1.0.2" };
  core_runtime: { core_commit: string; component_manifest_path: "contracts/edupi-desktop-component-manifest.json"; component_manifest_hash: string; runtime_component_manifest_hash: string; runtime_schema_hash: string };
  contract_identities: [EduPiBridgeContractIdentity, ScheduleOccurrenceContractIdentity];
  cumulative_projection_manifest: null | Record<string, unknown>;
  supported_commands: CoreCommandType[];
  supported_projections: string[];
  unsupported_command_reasons: Record<Exclude<CoreCommandType, "review_observation" | "review_memory_candidate" | "review_teacher_context" | "review_work_candidate" | "review_follow_up" | "review_task" | "import_calendar" | "import_timetable" | "intake_material" | "create_task" | "move_task_stage" | "update_memory">, string>;
  unsupported_projection_reasons: Record<string, string>;
  paired_prs: string[];
  change_note: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]));
}
const bridgeSchemaHash = `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(bridgeSchema))).digest("hex")}`;

export function loadEduPiCompatManifest(value: unknown = manifestJson): EduPiCompatManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid EduPi compatibility manifest");
  const manifest = value as EduPiCompatManifest;
  if (!Array.isArray(manifest.contract_identities) || manifest.contract_identities.some(item => !item || typeof item !== "object"
    || !Array.isArray(item.depends_on) || !Array.isArray(item.supported_commands) || !Array.isArray(item.supported_projections))
    || !Array.isArray(manifest.supported_projections) || !manifest.unsupported_command_reasons
    || typeof manifest.unsupported_command_reasons !== "object" || Array.isArray(manifest.unsupported_command_reasons)
    || !manifest.unsupported_projection_reasons || typeof manifest.unsupported_projection_reasons !== "object"
    || Array.isArray(manifest.unsupported_projection_reasons) || !Array.isArray(manifest.paired_prs)
    || manifest.paired_prs.some(item => typeof item !== "string") || typeof manifest.change_note !== "string"
    || (manifest.cumulative_projection_manifest !== null && (typeof manifest.cumulative_projection_manifest !== "object"
      || Array.isArray(manifest.cumulative_projection_manifest)))) throw new Error("Invalid EduPi compatibility manifest structure");
  if (manifest.compat_manifest_version !== "1.0" || manifest.core_repository !== "edupi") throw new Error("Invalid EduPi compatibility manifest");
  if (manifest.core_sdk?.pi !== "1.0.2" || manifest.core_sdk.pi_durable !== "1.0.2") throw new Error("Invalid EduPi Core SDK pairing");
  const runtime = manifest.core_runtime;
  const sha256 = (value: unknown): boolean => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)
    || Object.keys(runtime).sort().join("|") !== "component_manifest_hash|component_manifest_path|core_commit|runtime_component_manifest_hash|runtime_schema_hash"
    || !/^[a-f0-9]{40}$/.test(runtime.core_commit) || runtime.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json"
    || !sha256(runtime.component_manifest_hash) || !sha256(runtime.runtime_component_manifest_hash) || !sha256(runtime.runtime_schema_hash)) throw new Error("Invalid EduPi core_runtime identity");
  const identity = manifest.contract_identities.find((item) => item.contract_id === "edupi-bridge-v1.1") as EduPiBridgeContractIdentity | undefined;
  const occurrence = manifest.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2") as ScheduleOccurrenceContractIdentity | undefined;
  if (manifest.contract_identities.length !== 2 || !identity || identity.contract_version !== "1.1" || identity.schema_hash !== bridgeSchemaHash || identity.fixture_manifest_path !== "fixtures/bridge/v1.1/fixture-manifest.json" || identity.fixture_manifest_hash !== fixtureManifest.fixture_manifest_hash || identity.depends_on.length !== 0) throw new Error("Invalid EduPi v1.1 contract identity");
  if (!occurrence || occurrence.contract_version !== "1.2" || occurrence.schema_path !== "contracts/edupi-schedule-occurrence-v1.2.schema.json" || occurrence.schema_hash !== occurrenceHash.schema_hash || occurrence.supported_commands.length !== 1 || occurrence.supported_commands[0] !== "import_calendar" || occurrence.supported_projections.length !== 1 || occurrence.supported_projections[0] !== "schedule_occurrence" || occurrence.depends_on.length !== 1 || occurrence.depends_on[0] !== "edupi-bridge-v1.1") throw new Error("Invalid EduPi v1.2 occurrence contract identity");
  const supportedCommands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"] as const;
  const hasExactCommands = (value: unknown): boolean => Array.isArray(value)
    && value.length === supportedCommands.length
    && value.every((command, index) => command === supportedCommands[index]);
  if (!hasExactCommands(manifest.supported_commands) || !hasExactCommands(identity.supported_commands)) throw new Error("EduPi C1 command capability identity is incomplete");
  if (manifest.supported_projections.length !== 1 || manifest.supported_projections[0] !== "education_workspace" || identity.supported_projections.length !== 1 || identity.supported_projections[0] !== "education_workspace") throw new Error("EduPi education projection identity is incomplete");
  const expectedUnsupportedCommands = BRIDGE_COMMAND_TYPES.filter((command) => !supportedCommands.includes(command as typeof supportedCommands[number]));
  if (Object.keys(manifest.unsupported_command_reasons).sort().join("|") !== [...expectedUnsupportedCommands].sort().join("|")) throw new Error("EduPi command reason set is incomplete");
  for (const reason of [...Object.values(manifest.unsupported_command_reasons), ...Object.values(manifest.unsupported_projection_reasons)]) {
    if (typeof reason !== "string" || !reason.trim()) throw new Error("EduPi capability reason is missing");
  }
  return manifest;
}

export function activeBridgeIdentity() {
  const manifest = loadEduPiCompatManifest();
  const contract = manifest.contract_identities.find((item) => item.contract_id === "edupi-bridge-v1.1") as EduPiBridgeContractIdentity;
  return { runtime: manifest.core_runtime, contract };
}

export function scheduleOccurrenceIdentity(): ScheduleOccurrenceContractIdentity {
  const manifest = loadEduPiCompatManifest();
  return manifest.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2") as ScheduleOccurrenceContractIdentity;
}
