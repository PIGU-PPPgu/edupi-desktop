import type { CatalogProvider } from "./openconnector-catalog-contract";
import { connectorScenario, discoverConnectorProviders, type ConnectorScenario } from "./openconnector-discovery";

export type ManagedConnection = { connector_id?: string; label?: string; status?: string; capabilities?: string[] };
export type ConnectionApp = {
  id: string;
  displayName: string;
  iconService: string | null;
  scenario: Exclude<ConnectorScenario, "all">;
  services: CatalogProvider[];
  managedId?: string;
  managedStatus?: string;
};

// Only known variants of the same product share an entry. Unknown services and
// different Google products retain their own identities and action boundaries.
const brands = [
  { id: "feishu", displayName: "飞书", iconService: "feishu", services: ["feishu", "feishu_app_bot", "feishu_custom_bot"], managedId: "feishu" },
  { id: "dingtalk", displayName: "钉钉", iconService: "dingtalk_bot", services: ["dingtalk_bot", "dingtalk_mcp"], managedId: "dingtalk" },
  { id: "wecom", displayName: "企业微信", iconService: "wecom_bot", services: ["wecom_bot", "wecom_mcp"] },
] as const;
const schoolConnections = [
  { id: "email", displayName: "学校邮箱", scenario: "communication" },
  { id: "sis", displayName: "教务系统", scenario: "productivity" },
  { id: "cloud_drive", displayName: "学校云盘", scenario: "data-storage" },
] as const;

export function managedConnectionState(status?: string): { label: string; saved: boolean; connected: boolean } {
  if (status === "connected" || status === "conversation_verified") return { label: "已连接", saved: true, connected: true };
  if (status === "configured") return { label: "已配置", saved: true, connected: false };
  if (status === "credentials_verified") return { label: "凭据已验证", saved: true, connected: false };
  return { label: "未接入", saved: false, connected: false };
}

export function buildConnectionDirectory(providers: readonly CatalogProvider[], managed: readonly ManagedConnection[] = [], githubAuthorized = false): ConnectionApp[] {
  const apps = new Map<string, ConnectionApp>();
  const ranked = discoverConnectorProviders(providers, { connectedServices: new Set(githubAuthorized ? ["github"] : []) });
  for (const provider of ranked) {
    const brand = brands.find((item) => (item.services as readonly string[]).includes(provider.service));
    const id = brand?.id || provider.service;
    const current = apps.get(id);
    if (current) current.services.push(provider);
    else apps.set(id, {
      id, displayName: brand?.displayName || provider.displayName,
      iconService: brand?.iconService || provider.service,
      scenario: brand ? "communication" : connectorScenario(provider), services: [provider],
      ...(brand && "managedId" in brand ? { managedId: brand.managedId } : {}),
    });
  }
  // These are existing first-party setup surfaces, not synthesized catalog
  // providers. They never acquire action IDs or executable credentials here.
  for (const brand of brands) {
    if (!("managedId" in brand)) continue;
    const app = apps.get(brand.id) || {
      id: brand.id, displayName: brand.displayName, iconService: brand.iconService,
      scenario: "communication" as const, services: [], managedId: brand.managedId,
    };
    app.managedStatus = managed.find((item) => item.connector_id === brand.managedId)?.status;
    apps.set(brand.id, app);
  }
  for (const item of schoolConnections) apps.set(`school/${item.id}`, {
    id: `school/${item.id}`, displayName: item.displayName, iconService: null,
    scenario: item.scenario, services: [], managedId: item.id,
    managedStatus: managed.find((connection) => connection.connector_id === item.id)?.status,
  });
  if (githubAuthorized && !apps.has("github")) apps.set("github", {
    id: "github", displayName: "GitHub", iconService: "github", scenario: "developer", services: [],
  });
  return [...apps.values()].sort((left, right) => {
    const saved = (app: ConnectionApp) => app.id === "github" && githubAuthorized || managedConnectionState(app.managedStatus).saved;
    return Number(saved(right)) - Number(saved(left));
  });
}

function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s_.-]+/gu, ""); }

export function findConnectionApps(apps: readonly ConnectionApp[], query = "", scenario: ConnectorScenario = "all"): ConnectionApp[] {
  const terms = query.trim().split(/\s+/u).map(normalize).filter(Boolean);
  return apps.filter((app) => {
    if (scenario !== "all" && app.scenario !== scenario && !app.services.some((provider) => connectorScenario(provider) === scenario)) return false;
    if (!terms.length) return true;
    const text = normalize([app.id, app.displayName, app.managedId || "", ...app.services.flatMap((provider) => [provider.service, provider.displayName])].join(" "));
    return terms.every((term) => text.includes(term)) || discoverConnectorProviders(app.services, { query }).length > 0;
  });
}

export function connectionPurposeLabel(provider: CatalogProvider): string {
  return ({ feishu: "文档与日程", feishu_app_bot: "应用机器人", feishu_custom_bot: "自定义机器人",
    dingtalk_bot: "群机器人", dingtalk_mcp: "文档与协作", wecom_bot: "群机器人", wecom_mcp: "文档与协作" } as Record<string, string>)[provider.service] || provider.displayName;
}
