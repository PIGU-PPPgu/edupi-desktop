export const SETTINGS_GROUPS = [
  { label: "个人", sections: [
    { id: "general", label: "常规", icon: "sliders" },
    { id: "profile", label: "教师信息", icon: "user" },
    { id: "notifications", label: "通知", icon: "bell" },
  ] },
  { label: "AI 与服务", sections: [
    { id: "models", label: "AI 与模型", icon: "spark" },
    { id: "connections", label: "应用连接", icon: "plug" },
    { id: "readiness", label: "自动运行", icon: "activity" },
  ] },
  { label: "本机", sections: [
    { id: "devices", label: "设备与权限", icon: "monitor" },
    { id: "data", label: "数据与隐私", icon: "database" },
    { id: "about", label: "关于与更新", icon: "info" },
  ] },
] as const;

export type SettingsSectionId = typeof SETTINGS_GROUPS[number]["sections"][number]["id"] | "system" | "deleted";
export type SettingsIconId = typeof SETTINGS_GROUPS[number]["sections"][number]["icon"] | "arrow" | "search" | "trash" | "tool";
export type SettingSearchResult = {
  id: string;
  label: string;
  section: SettingsSectionId;
  path: string;
  keywords: string;
  modelPane?: "chat" | "browser";
};

export const SETTINGS_SEARCH_ITEMS: readonly SettingSearchResult[] = [
  { id: "language", label: "语言", section: "general", path: "个人 / 常规", keywords: "中文 English language 界面语言" },
  { id: "appearance", label: "外观", section: "general", path: "个人 / 常规", keywords: "主题 浅色 深色 黑暗 dark light theme" },
  { id: "foreground", label: "过期事务收起", section: "general", path: "个人 / 常规", keywords: "工作台 自动收起 天数 过期 历史事务" },
  { id: "window-close", label: "关闭窗口时退出应用", section: "general", path: "个人 / 常规", keywords: "窗口 托盘 菜单栏 后台 退出 close" },
  { id: "teacher-profile", label: "教师资料", section: "profile", path: "个人 / 教师信息", keywords: "姓名 称呼 学校 身份 学科 年级 班级 个人资料 历史 修订" },
  { id: "completion-notifications", label: "任务完成通知", section: "notifications", path: "个人 / 通知", keywords: "后台 系统通知 提醒 通知测试" },
  { id: "notification-permission", label: "系统通知权限", section: "notifications", path: "个人 / 通知", keywords: "通知授权 macOS Windows 桌面通知" },
  { id: "chat-models", label: "对话模型", section: "models", path: "AI 与服务 / AI 与模型", keywords: "AI 默认模型 供应商 API Key 密钥 OpenAI DeepSeek Anthropic 模型服务", modelPane: "chat" },
  { id: "browser-decision", label: "浏览器决策", section: "models", path: "AI 与服务 / AI 与模型", keywords: "JEV Jev TypeSafe 浏览器 密钥 置信度 超时 快速决策", modelPane: "browser" },
  { id: "applications", label: "应用连接", section: "connections", path: "AI 与服务 / 应用连接", keywords: "OpenConnector 连接器 授权 OAuth GitHub 飞书 钉钉 企业微信 邮箱 云盘 Google 应用 服务" },
  { id: "automation-status", label: "自动运行状态", section: "readiness", path: "AI 与服务 / 自动运行", keywords: "概览 自主运行 主动运行 调度 后台计划 待交付" },
  { id: "automation-domains", label: "主动运行范围", section: "readiness", path: "AI 与服务 / 自动运行", keywords: "试用 课前准备 学生跟进 校历行政 课后复盘 家长沟通" },
  { id: "automation-history", label: "最近运行", section: "readiness", path: "AI 与服务 / 自动运行", keywords: "运行记录 失败记录 待确认 执行记录 结果" },
  { id: "computer-use", label: "桌面控制", section: "devices", path: "本机 / 设备与权限", keywords: "辅助功能 屏幕录制 电脑控制 系统权限 授权" },
  { id: "mobile", label: "手机继续对话", section: "devices", path: "本机 / 设备与权限", keywords: "手机控制 局域网 配对 二维码 phone mobile" },
  { id: "data-root", label: "数据目录", section: "data", path: "本机 / 数据与隐私", keywords: "文件夹 保存位置 工作空间 workspace 本地数据" },
  { id: "usage", label: "本地用量", section: "data", path: "本机 / 数据与隐私", keywords: "收集 隐私 同意 用量 统计 telemetry" },
  { id: "deleted-entities", label: "回收站", section: "deleted", path: "本机 / 数据与隐私", keywords: "删除 恢复 历史记录 trash" },
  { id: "updates", label: "检查更新", section: "about", path: "本机 / 关于与更新", keywords: "版本 升级 安装 更新包 下载 更新说明 release" },
  { id: "update-proxy", label: "更新代理", section: "about", path: "本机 / 关于与更新", keywords: "代理 网络 proxy 下载失败 检查失败" },
  { id: "runtime-status", label: "运行诊断", section: "system", path: "诊断", keywords: "Core 教育投影 内核 健康 重连 修复 系统 合同 兼容性 状态" },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s_.-]+/gu, "");
}

export function searchSettings(query: string): SettingSearchResult[] {
  const tokens = query.trim().split(/\s+/u).map(normalize).filter(Boolean);
  if (!tokens.length) return [];
  return SETTINGS_SEARCH_ITEMS.filter((item) => {
    const text = normalize(`${item.label} ${item.path} ${item.keywords}`);
    return tokens.every((token) => text.includes(token));
  }).sort((left, right) => {
    const direct = (item: SettingSearchResult) => tokens.every((token) => normalize(item.label).includes(token)) ? 0 : 1;
    return direct(left) - direct(right);
  });
}

export function isPreferenceSection(section: string): section is "general" | "profile" | "notifications" | "devices" | "data" | "about" {
  return ["general", "profile", "notifications", "devices", "data", "about"].includes(section);
}
