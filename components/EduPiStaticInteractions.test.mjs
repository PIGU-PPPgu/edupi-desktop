import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("EduPi content rows use disclosures for teaching depth and buttons for selected-object workspaces", async () => {
  const views = await read("./EduPiWorkspaceViews.tsx");
  const sider = await read("./EduPiObjectSider.tsx");
  const student = await read("./EduPiStudentWorkspace.tsx");
  const css = await read("../app/edupi-workbench.css");

  for (const className of [
    "edupi-knowledge-disclosure",
    "edupi-teaching-memory-disclosure",
  ]) {
    assert.match(views, new RegExp(`<details className="[^"]*\\b${className}\\b[^>]*>[\\s\\S]*?<summary>`), `${className} should contain a keyboard-accessible summary`);
  }

  assert.match(sider, /<button type="button" className=\{`edupi-object-row edupi-object-student/);
  assert.match(sider, /edupi-object-fact is-interactive/);
  assert.match(views, /edupi-record-detail/);
  assert.match(student, /edupi-student-profile__grid/);
  assert.doesNotMatch(sider, /edupi-object-person/);
  assert.match(css, /\.edupi-knowledge-row > summary \{[^}]*grid-template-columns: minmax\(145px, \.75fr\) minmax\(200px, 1\.25fr\) minmax\(150px, \.8fr\) auto;/);
  assert.match(css, /\.edupi-knowledge-row > summary::after \{ grid-column: 4; grid-row: 1; \}/);
  assert.match(css, /\.edupi-knowledge-row > summary \{ grid-template-columns: minmax\(0, 1fr\) auto; gap: 7px; \}/);
  assert.match(css, /\.edupi-knowledge-row > summary::after \{ grid-column: 2; grid-row: 1; \}/);
  assert.match(css, /\.edupi-knowledge-row > summary > p,[\s\S]*?\.edupi-knowledge-row > summary > small \{ grid-column: 1 \/ -1; \}/);
  assert.match(student, /function statusLabel[\s\S]*active: "观察中"[\s\S]*resolved: "已解决"/);
  assert.match(student, /trajectory\.slice\(\)\.reverse\(\)/);
  assert.doesNotMatch(views, /JSON\.stringify\(item\)/);
  assert.doesNotMatch(views, /evidenceIds\.join/);
  assert.doesNotMatch(sider, /String\(pattern\.(?:status|last_seen)\)|String\(student\.updated_at\)/);
  assert.match(views, /function growthReviewStateLabel[\s\S]*pending_review: "待验证"[\s\S]*accepted: "已确认"[\s\S]*confirmed: "已确认"[\s\S]*rejected: "已拒绝"[\s\S]*hold: "已暂缓"/);
  assert.doesNotMatch(views, /审核状态：\{theme\.reviewState\}/);
});
