import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const root = args.get("--root");
const flowId = args.get("--flow-id");
const stateFile = args.get("--state");
const sessionFile = args.get("--session");
const profile = args.get("--profile");
const configFile = args.get("--config");
const snapshotFile = args.get("--snapshot");
const month = args.get("--month");
const lockFile = args.get("--lock");
const browserLock = args.get("--browser-lock");

if (![root, flowId, stateFile, sessionFile, profile, configFile, snapshotFile, month, lockFile, browserLock]
  .every(value => typeof value === "string" && value.length > 0)) {
  process.exitCode = 2;
  throw new Error("invalid zhixue sync worker arguments");
}

const now = () => new Date().toISOString();
const ensurePrivateDir = directory => mkdirSync(directory, { recursive: true, mode: 0o700 });
const writeAtomic = (file, value) => {
  ensurePrivateDir(dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
};
const readJson = file => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
};
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return error?.code === "EPERM";
  }
};
const removeIfExists = file => {
  try { unlinkSync(file); } catch {}
};

const findBrowser = () => {
  const configured = process.env.EDUPI_ZHIXUE_BROWSER_PATH;
  if (configured && existsSync(configured)) return configured;
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    : process.platform === "win32"
      ? [
        join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
        join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
      ]
      : ["google-chrome", "chromium", "chromium-browser"];
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try { return execFileSync("which", [candidate], { encoding: "utf8" }).trim(); } catch {}
  }
  return "";
};

const config = readJson(configFile);
if (!config || typeof config !== "object"
  || typeof config.className !== "string" || !config.className.trim()
  || typeof config.subjectCode !== "string" || !/^\d+$/.test(config.subjectCode)
  || typeof config.phaseCode !== "string" || !/^\d+$/.test(config.phaseCode)
  || (config.gradeCode !== undefined && config.gradeCode !== null && !/^\d+$/.test(String(config.gradeCode)))
  || (config.schoolId !== undefined && config.schoolId !== null && typeof config.schoolId !== "string")
  || (config.classId !== undefined && config.classId !== null && typeof config.classId !== "string")) {
  writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: "同步配置不完整，需提供班级、学科和学段。" });
  process.exitCode = 3;
  throw new Error("invalid zhixue sync configuration");
}

ensurePrivateDir(root);
ensurePrivateDir(dirname(stateFile));
ensurePrivateDir(dirname(sessionFile));
ensurePrivateDir(profile);
ensurePrivateDir(dirname(snapshotFile));

const existingLock = readJson(lockFile);
if (existingLock && existingLock.flowId !== flowId
  && (alive(existingLock.pid) || (() => {
    try { return Date.now() - statSync(lockFile).mtimeMs < 30_000; } catch { return false; }
  })())) {
  writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: "已有同步任务在运行。" });
  process.exitCode = 4;
  process.exit();
}
removeIfExists(lockFile);
try {
  const descriptor = openSync(lockFile, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify({ version: 1, flowId, pid: process.pid, startedAt: now() })}\n`);
  } finally {
    closeSync(descriptor);
  }
} catch {
  writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: "同步任务已被另一个进程占用。" });
  process.exitCode = 4;
  process.exit();
}
const existingBrowserLock = readJson(browserLock);
if (existingBrowserLock && existingBrowserLock.flowId !== flowId && alive(existingBrowserLock.pid)) {
  writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: "浏览器登录会话已被另一个任务占用。" });
  removeIfExists(lockFile);
  process.exitCode = 4;
  process.exit();
}
try {
  if (existingBrowserLock?.flowId === flowId) {
    writeAtomic(browserLock, { ...existingBrowserLock, pid: process.pid, updatedAt: now() });
  } else {
    const descriptor = openSync(browserLock, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify({ version: 1, flowId, pid: process.pid, startedAt: now() })}\n`);
    } finally {
      closeSync(descriptor);
    }
  }
} catch {
  writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: "浏览器登录会话已被另一个任务占用。" });
  removeIfExists(lockFile);
  process.exitCode = 4;
  process.exit();
}

let context;
let stopping = false;
const stop = async code => {
  if (stopping) return;
  stopping = true;
  try { await context?.close(); } catch {}
  removeIfExists(lockFile);
  const browser = readJson(browserLock);
  if (browser?.flowId === flowId) removeIfExists(browserLock);
  process.exitCode = code;
};
process.on("SIGTERM", () => { void stop(143); });
process.on("SIGINT", () => { void stop(130); });

const extractToken = value => {
  const seen = new Set();
  const visit = current => {
    if (typeof current === "string" && current.length > 20) return current;
    if (!current || typeof current !== "object" || seen.has(current)) return "";
    seen.add(current);
    for (const child of Object.values(current)) {
      const token = visit(child);
      if (token) return token;
    }
    return "";
  };
  return visit(value);
};

const apiResult = async (page, url, body, headers = {}) => {
  const response = await page.request.post(url, {
    data: body,
    headers: { "Content-Type": "application/json", ...headers },
    timeout: 60_000,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`请求失败 ${response.status()} @ ${url.split("/").pop()}`);
  if (payload.errorCode !== undefined && payload.errorCode !== 0) {
    throw new Error(`接口返回错误 @ ${url.split("/").pop()}`);
  }
  if (payload.code !== undefined && payload.code !== "000000") {
    throw new Error(`接口返回错误 @ ${url.split("/").pop()}`);
  }
  return payload.result ?? payload;
};

const numeric = value => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const previousMonth = () => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

(async () => {
  writeAtomic(stateFile, {
    version: 1,
    flowId,
    status: "running",
    month,
    config: {
      className: config.className.trim(),
      subjectCode: config.subjectCode,
      phaseCode: config.phaseCode,
      gradeCode: config.gradeCode ?? null,
      schoolId: config.schoolId ?? null,
      classId: config.classId ?? null,
    },
    startedAt: now(),
    updatedAt: now(),
  });

  const session = readJson(sessionFile);
  if (!session || !Array.isArray(session.cookies) || session.cookies.length === 0) {
    writeAtomic(stateFile, { version: 1, flowId, status: "needs_login", month, error: "没有可用的智学网登录态，请先扫码。" });
    await stop(5);
    return;
  }

  const browser = findBrowser();
  if (!browser) {
    writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: "未找到 Chrome 或 Chromium。" });
    await stop(6);
    return;
  }

  context = await chromium.launchPersistentContext(profile, {
    executablePath: browser,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  await context.addCookies(session.cookies);
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto("https://www.zhixue.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const tokenResponse = await page.request.post("https://www.zhixue.com/container/app/token/getToken", { data: {} });
  const token = extractToken(await tokenResponse.json().catch(() => ({})));
  if (!token) {
    writeAtomic(stateFile, { version: 1, flowId, status: "needs_login", month, error: "智学网登录态已失效，请重新扫码。" });
    await stop(7);
    return;
  }

  const headers = { token, currentrole: "teacher", isxb: "true" };
  const userInfoResponse = await page.request.get(
    "https://gece.zhixue.com/api-supervise-ali/common/getUserInfo",
    { headers, timeout: 60_000 },
  );
  const userInfo = await userInfoResponse.json().catch(() => ({}));
  const discoveredSchoolId = userInfo?.result?.result?.areaId;
  const schoolId = config.schoolId || (typeof discoveredSchoolId === "string" ? discoveredSchoolId : "");
  if (!schoolId) throw new Error("无法确认学校身份，请在同步配置中提供 schoolId。");

  const [year, monthNumber] = month.split("-").map(Number);
  const termName = monthNumber >= 9 || monthNumber <= 2 ? "第一学期" : "第二学期";
  const reportListBody = {
    title: "",
    schoolId,
    phaseCode: config.phaseCode,
    subjectCode: config.subjectCode,
    gradeCode: config.gradeCode || "",
    academicYear: year,
    termName,
    fromSource: "web",
    page: 1,
    size: 50,
    orderBy: 2,
    order: "desc",
    hwTag: "",
    hwQueryType: null,
    screenClassType: "2",
    classId: config.classId || null,
    token,
  };
  const listUrl = "https://gece.zhixue.com/api-platform-report/report/list/teacher";
  const first = await apiResult(page, listUrl, reportListBody);
  const reports = [...(first.content || [])];
  const totalPages = Math.min(Number(first.totalPages || 1), 20);
  for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
    const pageResult = await apiResult(page, listUrl, { ...reportListBody, page: currentPage });
    reports.push(...(pageResult.content || []));
  }

  const classMatch = report => (report.classReportList || []).find(item => {
    const nameMatches = item.className === config.className.trim();
    const idMatches = !config.classId || String(item.classId) === String(config.classId);
    return nameMatches && idMatches;
  });
  const firstClassReport = reports.map(classMatch).find(Boolean);
  const classId = config.classId || firstClassReport?.classId;
  if (!classId) throw new Error(`没有找到班级「${config.className.trim()}」，请检查班级名称或 classId。`);
  const targetReports = reports.filter(report =>
    String(report.homeworkDeployTime || "").slice(0, 7) === month && Boolean(classMatch(report)));
  if (!targetReports.length) {
    writeAtomic(stateFile, {
      version: 1,
      flowId,
      status: "ok",
      completeness: "empty",
      month,
      config: { ...config, schoolId, classId },
      counts: { reports: 0, students: 0 },
      message: `已完成同步检查，但 ${month} 没有找到可用作业记录。`,
      finishedAt: now(),
      updatedAt: now(),
    });
    writeAtomic(snapshotFile, {
      version: 1,
      flowId,
      syncedAt: now(),
      month,
      config: { ...config, schoolId, classId },
      reports: [],
      students: [],
      completeness: "empty",
    });
    await stop(0);
    return;
  }

  const base = "https://gece.zhixue.com/api-platform-report/";
  const studentsById = new Map();
  const reportSummaries = [];
  for (const report of targetReports) {
    const classReport = classMatch(report) || {};
    const studentRows = [];
    let pageIndex = 1;
    let totalStudents = null;
    while (pageIndex <= 100) {
      const students = await apiResult(page, `${base}report/teacherStudent/getStudentListV4`, {
        homeworkId: report.homeworkId,
        classId,
        pageIndex,
        pageSize: 100,
        orderBy: "scoreRate",
        orderDirection: "DESC",
        userInfo: "",
        isPyj: false,
        isThird: false,
        scoreType: 1,
        token,
      });
      const list = Array.isArray(students.list) ? students.list : [];
      studentRows.push(...list);
      totalStudents ??= Number(students.total ?? students.totalCount ?? students.totalNum);
      if (list.length < 100 || (Number.isFinite(totalStudents) && studentRows.length >= totalStudents)) break;
      pageIndex += 1;
    }
    if (pageIndex > 100) throw new Error(`学生列表分页超过安全上限 @ ${report.homeworkId}`);
    const rows = studentRows.map((student, studentIndex) => {
      const name = typeof student.studentName === "string" ? student.studentName.trim() : "";
      const studentId = String(
        student.studentId
        ?? student.id
        ?? student.studentInfo?.studentId
        ?? `${name || "unknown"}#${studentIndex}`,
      );
      const scoreRate = numeric(student.scoreRate);
      if (name) {
        const current = studentsById.get(studentId) || { studentId, name, records: [] };
        current.records.push({
          homeworkId: report.homeworkId,
          title: report.title,
          deployedAt: report.homeworkDeployTime,
          score: student.score ?? null,
          scoreRate,
          classRank: student.classRank ?? null,
        });
        studentsById.set(studentId, current);
      }
      return {
        studentId,
        name: name || null,
        score: student.score ?? null,
        scoreRate,
        classRank: student.classRank ?? null,
      };
    });
    reportSummaries.push({
      homeworkId: report.homeworkId,
      title: report.title,
      deployedAt: report.homeworkDeployTime,
      classReport: {
        submitNum: classReport.submitNum ?? null,
        totalNum: classReport.totalNum ?? null,
        score: classReport.score ?? null,
      },
      students: rows,
    });
  }

  const studentsSummary = [...studentsById.values()].map(student => {
    const rates = student.records.map(record => record.scoreRate).filter(value => value !== null);
    const averageScoreRate = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
    return {
      studentId: student.studentId,
      name: student.name,
      averageScoreRate,
      records: student.records,
    };
  });
  const snapshot = {
    version: 1,
    flowId,
    syncedAt: now(),
    month,
    previousMonth: previousMonth(),
    config: {
      className: config.className.trim(),
      subjectCode: config.subjectCode,
      phaseCode: config.phaseCode,
      gradeCode: config.gradeCode ?? null,
      schoolId,
      classId,
    },
    completeness: "base_performance",
    reports: reportSummaries,
    students: studentsSummary,
    source: "zhixue",
  };
  writeAtomic(snapshotFile, snapshot);
  writeAtomic(stateFile, {
    version: 1,
    flowId,
    status: "ok",
    completeness: "base_performance",
    month,
    config: snapshot.config,
    counts: { reports: reportSummaries.length, students: studentsSummary.length },
    message: `已同步 ${reportSummaries.length} 份作业和 ${studentsSummary.length} 名学生的基础成绩数据。`,
    finishedAt: now(),
    updatedAt: now(),
  });
  await stop(0);
})().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  writeAtomic(stateFile, { version: 1, flowId, status: "failed", month, error: message, updatedAt: now() });
  await stop(1);
});
