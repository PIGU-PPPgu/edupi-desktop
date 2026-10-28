import metadataSnapshot from "./openconnector-provider-metadata.json";
import type { CatalogProvider } from "./openconnector-catalog-contract";

export const CONNECTOR_SCENARIOS = [
  { id: "all", label: "全部" },
  { id: "communication", label: "沟通" },
  { id: "docs", label: "文档" },
  { id: "productivity", label: "效率" },
  { id: "ai", label: "AI" },
  { id: "data-storage", label: "数据存储" },
  { id: "developer", label: "开发工具" },
  { id: "marketing", label: "营销" },
  { id: "cross-border-ecommerce", label: "电商" },
  { id: "other", label: "其他" },
] as const;

export type ConnectorScenario = typeof CONNECTOR_SCENARIOS[number]["id"];
type ProviderMetadata = { iconUrl?: string; searchAliases: string[] };
const metadata: Readonly<Record<string, ProviderMetadata>> = metadataSnapshot.providers;

// Local vocabulary supplements upstream aliases without renaming providers.
const teacherAliases: Readonly<Record<string, readonly string[]>> = {
  github: ["代码", "代码仓库", "开源", "仓库"],
  gmail: ["谷歌邮件", "邮箱"],
  googledrive: ["谷歌云盘", "谷歌网盘", "云盘"],
  googledocs: ["在线文档", "协作文档"],
  googlesheets: ["电子表格", "工作表"],
  googleslides: ["演示文稿", "PPT"],
  googlecalendar: ["谷歌日历", "日程", "日历"],
  googletasks: ["谷歌任务", "待办", "任务"],
  googleforms: ["谷歌表单", "表单", "问卷"],
  googlemeet: ["谷歌会议", "视频会议"],
  googlechat: ["谷歌聊天"],
  outlook: ["微软邮箱", "邮箱", "邮件"],
  outlook_calendar: ["微软日历", "日历", "日程"],
  microsoft_todo: ["微软待办", "待办", "任务"],
  microsoft_teams: ["微软团队", "视频会议", "协作"],
  notion: ["笔记", "知识库", "文档"],
  dropbox: ["网盘", "云盘"],
  tencent_docs: ["腾讯文档", "腾讯表格", "在线文档"],
  wps_mcp: ["WPS", "金山文档", "金山办公"],
  qq_mail: ["QQ邮箱", "邮箱", "邮件"],
  netease_mail: ["网易邮箱", "163邮箱", "126邮箱", "邮件"],
  netease_enterprise_mail: ["网易企业邮箱", "企业邮箱"],
  feishu: ["飞书", "Lark"],
  dingtalk_mcp: ["钉钉", "DingTalk"],
  wecom_bot: ["企业微信", "企微", "群机器人"],
  wecom_mcp: ["企业微信", "企微"],
  baidu_netdisk: ["百度网盘", "百度云盘", "网盘"],
  bilibili: ["哔哩哔哩", "B站"],
};

const commonServices = [
  "feishu", "dingtalk_bot", "wecom_bot", "tencent_docs", "wps_mcp", "qq_mail",
  "netease_mail", "gmail", "googledrive", "googledocs", "googlesheets", "googleslides",
  "googlecalendar", "googleforms", "outlook", "microsoft_teams", "notion", "github",
  "dingtalk_mcp", "wecom_mcp", "feishu_app_bot", "feishu_custom_bot", "microsoft_todo",
  "outlook_calendar", "googletasks", "baidu_netdisk", "dropbox",
];
const commonRanks = new Map(commonServices.map((service, index) => [service, index]));

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s_.-]+/gu, "");
}

export function connectorScenario(provider: CatalogProvider): Exclude<ConnectorScenario, "all"> {
  return CONNECTOR_SCENARIOS.some((scenario) => scenario.id !== "all" && scenario.id === provider.scenario)
    ? provider.scenario as Exclude<ConnectorScenario, "all"> : "other";
}

export function connectorScenarioLabel(provider: CatalogProvider): string {
  return CONNECTOR_SCENARIOS.find((scenario) => scenario.id === connectorScenario(provider))!.label;
}

export function isOfficialConnectorIcon(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "static.oomol.com"
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && url.pathname.startsWith("/logo/third-party/")
      && /\.(?:svg|png|jpe?g|webp|ico|avif)$/iu.test(url.pathname);
  } catch { return false; }
}

export function connectorIconUrl(service: string): string | null {
  const value = metadata[service]?.iconUrl;
  return isOfficialConnectorIcon(value) ? value : null;
}

export function connectorInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u);
  return (words.length > 1 ? words.slice(0, 2).map((word) => Array.from(word)[0]).join("")
    : Array.from(words[0] || "?").slice(0, 2).join("")).toLocaleUpperCase();
}

export function discoverConnectorProviders(
  providers: readonly CatalogProvider[],
  { query = "", scenario = "all", connectedServices = new Set<string>() }: {
    query?: string; scenario?: ConnectorScenario; connectedServices?: ReadonlySet<string>;
  } = {},
): CatalogProvider[] {
  const terms = query.trim().split(/\s+/u).map(normalizeSearch).filter(Boolean);
  return providers.filter((provider) => {
    if (scenario !== "all" && connectorScenario(provider) !== scenario) return false;
    if (!terms.length) return true;
    const text = normalizeSearch([
      provider.displayName, provider.service, provider.scenario, connectorScenarioLabel(provider),
      ...provider.categories, ...(metadata[provider.service]?.searchAliases || []),
      ...(teacherAliases[provider.service] || []),
    ].join(" "));
    return terms.every((term) => text.includes(term));
  }).sort((left, right) => {
    const connectedRank = Number(connectedServices.has(right.service)) - Number(connectedServices.has(left.service));
    if (connectedRank) return connectedRank;
    const commonRank = (commonRanks.get(left.service) ?? Number.MAX_SAFE_INTEGER)
      - (commonRanks.get(right.service) ?? Number.MAX_SAFE_INTEGER);
    return commonRank || left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}
