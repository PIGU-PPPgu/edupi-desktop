import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("one settings workspace provides grouped navigation and preserves real capability boundaries", async () => {
  const [admin, appShell, panel, rail, css, navigation] = await Promise.all([
    read("./EduPiAdminPanel.tsx"), read("./AppShell.tsx"), read("./EduPiEducationPanel.tsx"),
    read("./EduPiNavigationRail.tsx"), read("../app/edupi-admin.css"), read("../lib/edupi-settings-navigation.ts"),
  ]);
  assert.match(admin, /aria-label="EduPi 设置"/);
  assert.match(admin, /SETTINGS_GROUPS.map/);
  assert.match(admin, /aria-label="搜索设置"/);
  assert.match(admin, /searchSettings\(searchQuery\)/);
  assert.match(admin, /openSearchResult/);
  assert.match(admin, /scrollIntoView/);
  assert.match(admin, /target.focus\(\{ preventScroll: true \}\)/);
  assert.match(navigation, /label: "自动运行"/);
  assert.doesNotMatch(navigation, /label: "(?:设置|工作与资源|OpenConnector)"/);
  assert.match(admin, /section === "settings"\) return "general"/);
  assert.match(admin, /section === "automation"\) return "readiness"/);
  assert.match(admin, /section === "openconnector"\) return "connections"/);
  assert.match(admin, /<OpenConnectorAdminPanel managedConnections=/);
  assert.match(admin, /onManagedConfigured=\{refresh\}/);
  assert.doesNotMatch(admin, /连接类别|connectionPane|OpenConnectorConsolePanel/);
  assert.match(admin, /<JevSettingsCard \/>/);
  assert.match(admin, /data-setting-id="browser-decision"/);
  assert.match(admin, /settingsPanel\(settingsPage\)/);
  assert.match(admin, /hidden=\{!isPreferenceSection\(activeSection\)\}/);
  assert.match(admin, /modelsMounted/);
  assert.match(admin, /connectionsMounted/);
  assert.match(admin, /modelSettingsDirty && !window.confirm/);
  assert.match(admin, /if \(settingsBusy\) return/);
  for (const endpoint of ["/api/edupi/workspace", "/api/edupi/status", "/api/models"]) assert.ok(admin.includes(endpoint));
  for (const operation of ["reconnectEduPiCore", "repairEduPiCore", "readEducationEntityDeletions", "restoreEducationEntity", "kernelRunTitle", "kernelRunDetail", "kernelRunAction", "formatCoreSchedulerStatus"]) assert.ok(admin.includes(operation));
  assert.match(admin, /window.dispatchEvent\(new Event\("edupi-education-refresh"\)\)/);
  assert.match(admin, /<summary>技术信息<\/summary>/);
  assert.match(admin, /<summary>教育数据<\/summary>/);
  for (const field of ["skill.lifecycle_state", "skill.trial_count", "skill.can_reuse", "tenant.core_mode", "tenant.harness_count"]) assert.ok(admin.includes(field));
  assert.match(admin, /coreConnected && projectionConnected/);
  assert.match(admin, /snapshot.compatibility/);
  assert.match(admin, /has-desktop-drag-region/);
  assert.match(admin, /startWindowDragging/);
  assert.doesNotMatch(admin, /role="dialog"|aria-modal="true"/);
  assert.match(rail, /aria-label="设置"/);
  assert.doesNotMatch(rail, /管理中心/);
  assert.match(panel, /打开设置/);
  assert.match(appShell, /settingsPanel=\{\(page\) => <AppSettings embedded page=\{page\}/);
  assert.match(appShell, /modelsPanel=\{\(cwd\) => <ModelsConfig\s+embedded\s+cwd=\{cwd\}/);
  assert.match(admin, /modelsPanel\(education\?\.workspace\)/);
  assert.match(appShell, /<UpdateReminder onOpenSettings=\{\(\) => openEduPiAdmin\("about"\)\}/);
  assert.match(appShell, /setEduPiAdminSection\("devices"\)/);
  assert.match(appShell, /inert=\{edupiAdminOpen \? true : undefined\}/);
  assert.match(css, /edupi-settings-search-results/);
  assert.match(css, /edupi-settings-nav-group/);
});

test("management center preserves typed boundaries for unsupported destructive operations", async () => {
  const admin = await read("./EduPiAdminPanel.tsx");
  assert.doesNotMatch(admin, /fetch\([^)]*method:\s*["'](?:PUT|POST|PATCH|DELETE)/s);
  assert.doesNotMatch(admin, /localStorage|sessionStorage|writeFile|\.edupi\/memory/);
  assert.doesNotMatch(admin, /删除学生|删除校历|删除已接入/);
});
