import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("management center is reachable and reuses existing canonical surfaces", async () => {
  const [admin, appShell, panel, rail, workspace, css] = await Promise.all([
    read("./EduPiAdminPanel.tsx"),
    read("./AppShell.tsx"),
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiNavigationRail.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("../app/edupi-admin.css"),
  ]);

  for (const endpoint of ["/api/edupi/onboarding", "/api/edupi/education", "/api/edupi/status", "/api/models"]) assert.match(admin, new RegExp(endpoint.replaceAll("/", "\\/")));
  for (const label of ["管理中心", "EduPi 就绪度", "AI 与模型", "教师与学生", "校历与课表", "上传内容", "任务与产物", "系统"]) assert.match(admin, new RegExp(label));
  assert.match(admin, /onOpenModels/);
  assert.match(admin, /onNavigate\("students"\)/);
  assert.match(admin, /onAskStudentUpdate/);
  assert.match(admin, /onNavigate\("calendar"\)/);
  assert.match(admin, /onNavigate\("materials"\)/);
  assert.match(admin, /onNavigate\("workspace"\)/);
  assert.match(admin, /不会直接修改底层 JSON/);
  assert.match(admin, /<details className="edupi-admin-boundary">/);
  assert.equal((admin.match(/<p(?:\s|>)/g) || []).length, 0);
  assert.match(admin, /FALLBACK_CHECKLIST/);
  assert.match(admin, /数据读取失败/);
  assert.match(admin, /模型数据不可用/);
  assert.match(admin, /检查模型服务/);
  assert.doesNotMatch(admin, /education\?\.[a-zA-Z]+\.length \|\| 0/);
  assert.doesNotMatch(admin, /snapshot\.models\?\.modelList\?\.length \|\| 0/);
  assert.doesNotMatch(admin, /配置模块即将接入|EduPiWorkspace/);

  assert.match(rail, /aria-label="管理中心"/);
  assert.doesNotMatch(rail, /aria-label="教育设置"|aria-label="应用设置"/);
  assert.match(panel, /onOpenAdmin/);
  assert.match(panel, /打开管理中心/);
  assert.match(panel, /<EduPiNavigationRail[^>]+onOpenAdmin=\{onOpenAdmin\}/);
  assert.match(appShell, /onOpenAdmin=\{\(\) => setEduPiAdminOpen\(true\)\}/);
  assert.match(appShell, /edupiAdminOpen && <EduPiAdminPanel/);
  assert.match(appShell, /onOpenModels=\{\(\) => setModelsConfigOpen\(true\)\}/);
  assert.match(appShell, /onAskStudentUpdate=\{askEduPiToUpdateStudents\}/);
  assert.match(appShell, /onOpenSettings=\{\(\) => \{ setEduPiAdminOpen\(false\); setAppSettingsOpen\(true\); \}\}/);
  assert.match(appShell, /params\.set\("view", view\)/);
  assert.match(workspace, /EduPi 就绪度/);
  assert.match(workspace, /onOpenAdmin/);
  assert.match(workspace, /onRemoveStagedMaterial/);
  assert.match(workspace, />移除</);
  assert.match(css, /\.edupi-admin-grid/);
  assert.match(css, /\.edupi-admin-readiness/);
});

test("management center preserves typed boundaries for unsupported destructive operations", async () => {
  const admin = await read("./EduPiAdminPanel.tsx");
  assert.doesNotMatch(admin, /fetch\([^)]*method:\s*["'](?:PUT|POST|PATCH|DELETE)/s);
  assert.doesNotMatch(admin, /localStorage|sessionStorage|writeFile|\.edupi\/memory/);
  assert.doesNotMatch(admin, /删除学生|删除校历|删除已接入/);
});
