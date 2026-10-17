#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";

// Run only against the pinned Core and a newly-created synthetic workspace.
// Resume preserves the exact workspace and local model port; no real credentials
// or user sessions are copied. Ctrl-C stops the owned servers and preserves data.
const args = process.argv.slice(2);
const arg = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const production = args.includes("--production");
const worktree = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const coreRoot = fs.realpathSync(arg("--core") || process.env.EDUPI_CORE_ROOT || "");
const compatibility = JSON.parse(fs.readFileSync(path.join(worktree, "contracts/edupi-core-compat.json"), "utf8"));
const coreCommit = compatibility.core_runtime.core_commit;
const resumed = arg("--resume");
const root = resumed ? fs.realpathSync(resumed) : (fs.mkdirSync(process.env.DEMO_ROOT, { recursive: true }), fs.realpathSync(process.env.DEMO_ROOT));
const dataRoot = path.join(root, "teacher-data");
const memoryDir = path.join(dataRoot, ".edupi", "memory");
const outputDir = path.join(dataRoot, ".edupi", "output");
const lockDir = path.join(dataRoot, ".edupi", "locks");
const agentDir = path.join(root, "pi-agent");
const stateDir = path.join(root, "desktop-state");
for (const directory of [memoryDir, outputDir, lockDir, agentDir, stateDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const writeJSON = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { shanghaiDate } = await jiti.import("../lib/edupi-foreground.ts");
const { addCalendarDays } = await jiti.import("../lib/edupi-calendar-model.ts");
const today = shanghaiDate();
const port = Number(arg("--port") || 30373);
assert.equal(Number.isInteger(port) && port >= 1024 && port <= 65535, true);
async function listen(server, listenPort) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(listenPort, "127.0.0.1", resolve); });
  return server.address().port;
}
const probe = net.createServer();
await listen(probe, port);
await new Promise(resolve => probe.close(resolve));

let modelCalls = 0;
const model = http.createServer(async (request, response) => {
  if (request.url === "/v1/models") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: [{ id: "local", object: "model", owned_by: "fixture" }] })); return; }
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  let body = "";
  for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) { response.writeHead(413); response.end(); return; } }
  let input;
  try { input = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
  modelCalls += 1;
  const messages = input.messages || [];
  const userIndex = messages.findLastIndex(item => item.role === "user");
  const last = messages[userIndex];
  const content = typeof last?.content === "string" ? last.content
    : Array.isArray(last?.content) ? last.content.filter(item => item.type === "text").map(item => item.text).join("\n") : "合成验收请求";
  const toolCompleted = messages.slice(userIndex + 1).some(item => item.role === "tool");
  const calendarCall = content.includes("fixture-calendar-write") && !toolCompleted
    && input.tools?.some(item => item.function?.name === "calendar_import")
      ? { id: `fixture-calendar-${modelCalls}`, type: "function", function: { name: "calendar_import", arguments: JSON.stringify({ events:
        ["2026-10-08", "2026-10-09", "2026-10-10"].map(date => ({ date, name: "合成页面日程", type: "meeting", confidence: "teacher_confirmed" })) }) } }
      : null;
  const sourceStudent = /fixture-student-source:([A-Za-z0-9._-]{1,160})/u.exec(content)?.[1];
  const fixtureCall = calendarCall ?? (sourceStudent && !toolCompleted
    && input.tools?.some(item => item.function?.name === "edupi_student_records")
      ? { id: `fixture-source-${modelCalls}`, type: "function", function: { name: "edupi_student_records", arguments: JSON.stringify({ action: "record", records: [
        { kind: "learning", student_ids: [sourceStudent], summary: "合成原始对话验收：移项时先核对符号", topic: "移项", observed_on: today },
      ] }) } } : null);
  const message = /先准备什么/.test(content)
    ? "张老师，今天周四，第 3 节有七年级数学《有理数的加减》。建议先做三件事：\n1. 课前准备清单已生成，等你确认；\n2. 张三连续三次在移项变号上出错，课前花三分钟单独强调；\n3. “国庆后返校安排”提醒还有 1 项待审核。"
    : `收到：${content.slice(0, 60)}`;
  const id = `fixture-chat-${modelCalls}`;
  if (!input.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ id, object: "chat.completion", model: "local", choices: [{ index: 0, message: { role: "assistant", content: fixtureCall ? null : message, ...(fixtureCall ? { tool_calls: [fixtureCall] } : {}) }, finish_reason: fixtureCall ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })); return; }
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  if (fixtureCall) {
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, ...fixtureCall }] }, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
    return;
  }
  const chunks = message.match(/[\s\S]{1,6}/gu) || [message];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length) {
      response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: index === 0 ? { role: "assistant", content: chunks[index++] } : { content: chunks[index++] }, finish_reason: null }] })}\n\n`);
    } else { clearInterval(timer); response.end(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`); }
  }, /fixture-long-running/.test(content) ? 500 : 75);
  response.on("close", () => clearInterval(timer));
});
const previousMetadata = resumed ? JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8")) : null;
const modelPort = await listen(model, previousMetadata?.modelPort || 0);
const environment = {
  PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "Asia/Shanghai",
  NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", PI_OFFLINE: "1",
  PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir,
  EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root, EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir,
  EDUPI_REGISTRATION_FILE: path.join(agentDir, "edupi-registration.json"),
  EDUPI_INVITE_CODE_SHA256: createHash("sha256").update("synthetic-fixture-only").digest("hex"),
};
Object.assign(process.env, environment);
writeJSON(path.join(agentDir, "models.json"), { providers: { local: { api: "openai-completions", apiKey: "synthetic-local-placeholder", baseUrl: `http://127.0.0.1:${modelPort}/v1`, models: [{ id: "local", name: "EduPi 演示模型", input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] } } });
if (!resumed) writeJSON(path.join(agentDir, "settings.json"), { defaultProvider: "local", defaultModel: "local", extensions: [], packages: [], skills: [] });
const jsonRequest = (url, method, value) => new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(value) });
const { closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
if (!resumed) {
  const D = (n) => addCalendarDays(today, n);
  const assets = process.env.DEMO_ASSETS;
  writeJSON(path.join(memoryDir, "calendar.json"), { events: [
    { id: "ev-nat", name: "国庆放假", type: "festival", date: "2026-10-01", end_date: "2026-10-07", source: "校历", confidence: "confirmed" },
    { id: "ev-back", name: "国庆后返校", type: "teaching", date: "2026-10-08", source: "校历", confidence: "confirmed" },
    { id: "ev-week", name: "第 7 周 · 期中前复习周", type: "teaching", date: D(-3), end_date: D(3), source: "teacher", confidence: "teacher_confirmed" },
    { id: "ev-grp", name: "数学教研组活动", type: "meeting", date: D(1), source: "通知", confidence: "confirmed" },
    { id: "ev-parent", name: "七年级家长会", type: "meeting", date: "2026-10-20", source: "通知", confidence: "confirmed" },
    { id: "ev-class", name: "班会：期中复习动员", type: "meeting", date: "2026-10-23", source: "teacher", confidence: "teacher_confirmed" },
    { id: "ev-sports", name: "秋季运动会", type: "meeting", date: "2026-10-27", end_date: "2026-10-28", source: "通知", confidence: "confirmed" },
    { id: "ev-mid", name: "期中考试", type: "exam", source: "通知", confidence: "inferred", notes: "原文：期中考试时间另行通知。" },
  ] });
  writeJSON(path.join(memoryDir, "timetable.json"), { slots: [[1, 2], [2, 4], [4, 3], [5, 1]].map(([day, period]) => ({ id: `slot-${day}-${period}`, day_of_week: day, period, subject: "数学", class_name: "703", kind: "class" })) });
  writeJSON(path.join(memoryDir, "preferences.json"), { entries: [] });
  writeJSON(path.join(memoryDir, "semester.json"), { start_date: "2026-08-31", end_date: "2027-01-15", entries: [] });
  writeJSON(path.join(memoryDir, "parent_profiles.json"), {});
  const dailyDir = path.join(outputDir, "daily"); fs.mkdirSync(dailyDir, { recursive: true });
  fs.writeFileSync(path.join(dailyDir, `${D(-1)}.md`), `---\ntitle: 早安简报 ${D(-1)}\ndate: ${D(-1)}\n---\n# 早安简报\n\n昨日简报。\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dailyDir, `${today}.md`), `---\ntitle: 早安简报 ${today}\ndate: ${today}\n---\n# 今日简报\n\n张老师早上好。今天 18:00 前要提交本周班级周报，周一要提交班主任工作计划，周一还有家长会发言提纲；张三近三次在移项变号上出错，下次备课需要留意。周报初稿和计划初稿已经备好，等你确认。\n`, { mode: 0o600 });
  writeJSON(path.join(outputDir, "rhythm_plan.json"), { tasks: [] });
  const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
  const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
  const preparedRoot = prepareCoreRuntimeRoot(dataRoot);
  assert.equal(preparedRoot.ok, true);
  const { registerEduPi } = await jiti.import("../lib/edupi-registration.ts");
  registerEduPi("synthetic-fixture-only");
  const onboarding = await jiti.import("../app/api/edupi/onboarding/route.ts");
  const identity = await onboarding.POST(jsonRequest("http://localhost/api/edupi/onboarding", "POST", { name: "张老师", subject: "数学", grade: "七年级", class_name: "703", role: "subject_teacher" }));
  assert.equal(identity.status, 200, JSON.stringify(await identity.clone().json()));
  const { importStudentRoster } = await jiti.import("../lib/edupi-student-roster-server.ts");
  const names = ["张三", "李四", "赵六", "王五", "陈雨桐", "刘子涵", "杨梓萱", "周浩然", "吴思琪", "徐嘉怡", "孙宇航", "马心怡"];
  await importStudentRoster({ students: names.map(name => ({ name, className: "703", traits: [], parentNotes: name === "张三" ? ["张三妈妈关心数学成绩，希望每周收到简短反馈。", "10 月 9 日家长来电，询问成绩退步，约定周五回复。"] : [] })), sourceName: "七年级3班名单.xlsx" });
  const { GET: getWorkspace } = await jiti.import("../app/api/edupi/workspace/route.ts");
  const initial = await (await getWorkspace()).json();
  const idOf = name => initial.data.students.find(row => row.name === name && row.class_name === "703").student_id;
  const { createStudentEventTool } = await jiti.import("../lib/edupi-student-event-tool.ts");
  const tool = createStudentEventTool(dataRoot);
  const events = [
    [["张三"], "learning", "周测：移项变号出错", "2026-09-22", "移项变号"], [["张三"], "learning", "课堂练习：解方程时再次漏变号", "2026-09-25", "解方程"], [["张三"], "learning", "作业：同类移项错误第三次出现", "2026-10-09", "移项"],
    [["李四"], "learning", "独立完成应用题，列式正确", "2026-10-14", "应用题"], [["李四", "王五"], "interaction", "李四主动帮助王五核对解方程步骤", "2026-10-12", "解方程"],
    [["赵六"], "learning", "课堂上走神，提醒后回到状态", "2026-10-13", "走神"], [["王五"], "learning", "有理数加法法则掌握较好", "2026-10-13", "有理数加法"],
    [["陈雨桐"], "learning", "周测满分，计算准确", "2026-10-10", "周测"], [["刘子涵", "吴思琪"], "interaction", "小组讨论中刘子涵与吴思琪互相讲解", "2026-10-14", "小组讨论"],
  ];
  for (const name of [...new Set(events.map(e => e[0][0]))]) {
    const rows = events.filter(e => e[0][0] === name).map(([who, kind, summary, on, topic]) => ({ kind, student_ids: who.map(idOf), summary, topic, observed_on: on }));
    await tool.execute(`demo-events-${name}`, { action: "record", records: rows }, undefined, undefined, { cwd: dataRoot, sessionManager: { getSessionId: () => `demo-source-${name}`, getBranch: () => [{ type: "message", id: `demo-source-message-${name}`, message: { role: "user", content: `${today}的教师记录：${rows.map(r => r.summary).join("。")}` } }] } });
  }
  const admission = await acquireCoreRuntimeWriterAdmission({ root: preparedRoot, kind: "legacy_c1_e2", busyTimeoutMs: 2000 });
  try {
    const { captureTeacherObservation } = await jiti.import(path.join(coreRoot, "extensions", "teacher_observation.ts"));
    const obs = [
      ["teacher-note-1015-1", "张三这周解方程连续三次在移项变号上出错，需要课前单独强调。", ["移项", "课堂观察"]],
      ["teacher-note-1015-2", "李四今天终于能独立做对应用题，进步明显。", ["进步", "应用题"]],
      ["teacher-note-1015-3", "赵六本周上课走神两次，需要留意座位与状态。", ["课堂状态"]],
    ];
    for (const [id, text, tags] of obs) captureTeacherObservation({ source_message_id: id, text, observed_at: `${today}T08:30:00.000Z`, subject: "math", class_id: "703", category: "teaching", matched_rules: ["demo-rule"], tags });
  } finally { await admission.release(); }
  const { POST: createTask } = await jiti.import("../app/api/edupi/tasks/route.ts");
  const { PATCH: moveTask } = await jiti.import("../app/api/edupi/tasks/[taskId]/route.ts");
  const { randomUUID } = await import("node:crypto");
  const tasks = [
    ["第 7 周班级周报（今天 18:00 提交）", D(0), "EduPi 已备好初稿，等待教师确认", "review"],
    ["班主任工作计划（周一提交）", D(3), "EduPi 已备好初稿，等待教师确认", "review"],
    ["七年级家长会（10/20）发言提纲", D(3), "EduPi 已备好初稿，等待教师确认", "review"],
    ["七年级数学《有理数的加减》课前准备清单", D(3), "课表：周一第 2 节；EduPi 正在整理", "progress"],
    ["秋季运动会班级报名表", "2026-10-24", "校历：秋季运动会", "todo"],
    ["第二章 一元一次方程 课后习题讲评", D(-3), "", "done"], ["第 6 周班级周报", D(-7), "", "done"], ["月考试卷分析", D(-9), "", "done"],
  ];
  for (const [title, dueDate, note, stage] of tasks) {
    const rid = randomUUID(); const response = await createTask(jsonRequest("http://localhost/api/edupi/tasks", "POST", { clientRequestId: rid, title, dueDate, ...(note ? { note } : {}) }));
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    if (stage !== "todo") { const id = `teacher-task-${rid.toLowerCase()}`; const moved = await moveTask(jsonRequest("http://localhost/api/edupi/tasks/x", "PATCH", { stage, expectedRevision: 0, note: stage === "done" ? "教师已完成" : "EduPi 已准备" }), { params: Promise.resolve({ taskId: id }) }); assert.equal(moved.status, 200, JSON.stringify(await moved.clone().json())); }
  }
  const { resolveEduPiBridgeRoots, readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");
  const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
  const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const { issueEducationIntake } = await jiti.import("../lib/edupi-education-intake.ts");
  const roots = resolveEduPiBridgeRoots();
  for (const [file, title, kind] of [["lesson.pdf", "七年级数学 第三章 有理数的加减 教案", "lesson_note"], ["notice.pdf", "国庆放假及返校通知", "worksheet"], ["quiz.pdf", "第三章周测 试卷分析", "assessment"]]) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(assets, file)));
    const descriptor = stageMaterialInputs([{ name: file, mimeType: "application/pdf", bytes }])[0];
    const imported = await intakeRecognizedMaterial({ descriptor, title, materialKind: kind, subject: "数学", classId: "703", recognize: false }, { issue: command => issueEducationIntake(command, { readSnapshot: async () => ({ payload: (await readEduPiEducationSnapshot({ roots })).payload, roots }) }) });
    assert.equal(imported.receipts[0].status, "accepted");
  }
  await closeAllEduPiRuntimes();
}
const log = fs.openSync(path.join(root, "next.log"), "a", 0o600);
let next, builder, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  builder?.kill("SIGTERM"); next?.kill("SIGTERM");
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await closeAllEduPiRuntimes();
  console.log(JSON.stringify({ status: "stopped", root, preserved: true })); process.exit(0);
}
process.on("SIGINT", () => void stop()); process.on("SIGTERM", () => void stop());
const nextBinary = path.join(worktree, "node_modules", "next", "dist", "bin", "next");
if (production) {
  environment.NODE_ENV = "production";
  environment.PI_WEB_DESKTOP_BUILD = "1";
  console.log(JSON.stringify({ status: "production-source-build", root, installedApp: false }));
  builder = spawn(process.execPath, [nextBinary, "build", "--webpack"], { cwd: worktree, env: environment, stdio: ["ignore", log, log] });
  const code = await new Promise((resolve, reject) => { builder.once("error", reject); builder.once("exit", resolve); });
  builder = null;
  if (code !== 0) { console.error(JSON.stringify({ status: "build-failed", code, root })); await stop(); }
}
next = spawn(process.execPath, [nextBinary, production ? "start" : "dev", ...(production ? [] : ["--webpack"]), "-H", "127.0.0.1", "-p", String(port)], { cwd: worktree, env: environment, stdio: ["ignore", log, log] });
fs.closeSync(log);
const supplemental = fs.existsSync(path.join(root, "p0p2-resources.json")) ? JSON.parse(fs.readFileSync(path.join(root, "p0p2-resources.json"), "utf8")) : null;
const metadata = { root, dataRoot, agentDir, stateDir, url: `http://127.0.0.1:${port}`, port, modelPort, coreRoot, coreCommit, runnerPid: process.pid, nextPid: next.pid, today, synthetic: true, mode: production ? "production_source" : "development", students: 3, studentEvents: supplemental?.studentEvents ?? 26, taskCount: 36, resume: `node scripts/run-edupi-p0p2-fixture.mjs --core ${coreRoot} --resume ${root} --port ${port}${production ? " --production" : ""}` };
writeJSON(path.join(root, "fixture.json"), metadata);
next.on("exit", code => { if (!stopping) { console.error(JSON.stringify({ status: "next-exited", code, root })); void stop(); } });
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { const response = await fetch(`${metadata.url}/api/home`); if (response.ok) { console.log(JSON.stringify({ status: "ready", ...metadata })); break; } } catch { /* Cold compilation. */ }
  await new Promise(resolve => setTimeout(resolve, 300));
  if (attempt === 99) throw new Error(`Fixture dev server did not start; inspect ${path.join(root, "next.log")}`);
}
