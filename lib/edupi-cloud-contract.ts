// Keep this identity in one server-side module. The contract-alignment test
// compares it with contracts/edupi-mobile-dashboard-v1.json, the broker and
// the iOS decoder so clients fail closed when any copy changes.
export const EDUPI_MOBILE_DASHBOARD_CONTRACT = Object.freeze({
  contract_id: "edupi-mobile-dashboard-v1",
  contract_version: "1.0",
  schema_hash: "sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8",
});

export type EduPiMobileDashboardPayload = {
  workspace_id: string;
  students: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  calendar: Array<Record<string, unknown>>;
  timetable: Array<Record<string, unknown>>;
  external_send: false;
};

export type EduPiMobileDashboardResponse = {
  ok: true;
  operation: "mobile-dashboard";
  contract: typeof EDUPI_MOBILE_DASHBOARD_CONTRACT;
  payload: EduPiMobileDashboardPayload;
  external_send: false;
};

export class EduPiCloudContractError extends Error {
  readonly code = "unsupported_contract";
  constructor() { super("云端 contract 版本或 schema hash 不受支持，请更新客户端。"); }
}

export function assertMobileDashboardContract(value: unknown): asserts value is EduPiMobileDashboardResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("云端返回不是 JSON 对象");
  }
  const response = value as Record<string, unknown>;
  const contract = response.contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new EduPiCloudContractError();
  }
  const identity = contract as Record<string, unknown>;
  if (identity.contract_id !== EDUPI_MOBILE_DASHBOARD_CONTRACT.contract_id
    || identity.contract_version !== EDUPI_MOBILE_DASHBOARD_CONTRACT.contract_version
    || identity.schema_hash !== EDUPI_MOBILE_DASHBOARD_CONTRACT.schema_hash) {
    throw new EduPiCloudContractError();
  }
  if (response.ok !== true || response.operation !== "mobile-dashboard" || response.external_send !== false) {
    throw new Error("云端 mobile-dashboard 响应不符合安全合同");
  }
  const payload = response.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("云端 mobile-dashboard payload 无效");
  }
  const data = payload as Record<string, unknown>;
  if (typeof data.workspace_id !== "string"
    || !Array.isArray(data.students)
    || !Array.isArray(data.tasks)
    || !Array.isArray(data.calendar)
    || !Array.isArray(data.timetable)
    || data.external_send !== false) {
    throw new Error("云端 mobile-dashboard payload 字段无效");
  }
}
