import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = args.get("--root");
const flowId = args.get("--flow-id");
const stateFile = args.get("--state");
const sessionFile = args.get("--session");
const qrFile = args.get("--qr");
const profile = args.get("--profile");
const browserLock = args.get("--browser-lock");

if (![root, flowId, stateFile, sessionFile, qrFile, profile, browserLock].every(value => typeof value === "string" && value.length > 0)) {
  process.exitCode = 2;
  throw new Error("invalid zhixue login worker arguments");
}

const now = () => new Date().toISOString();
const ensurePrivateDir = directory => mkdirSync(directory, { recursive: true, mode: 0o700 });
const writeAtomic = (file, value) => {
  ensurePrivateDir(dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
};
const updateState = patch => {
  let previous = {};
  try { previous = JSON.parse(readFileSync(stateFile, "utf8")); } catch {}
  writeAtomic(stateFile, { ...previous, ...patch, flowId, updatedAt: now() });
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

let context;
let stopping = false;
const stop = async code => {
  if (stopping) return;
  stopping = true;
  removeIfExists(qrFile);
  try { await context?.close(); } catch {}
  try {
    const lock = JSON.parse(readFileSync(browserLock, "utf8"));
    if (lock.flowId === flowId) removeIfExists(browserLock);
  } catch {}
  process.exitCode = code;
};
process.on("SIGTERM", () => { void stop(143); });
process.on("SIGINT", () => { void stop(130); });

(async () => {
  ensurePrivateDir(root);
  ensurePrivateDir(dirname(stateFile));
  ensurePrivateDir(dirname(sessionFile));
  ensurePrivateDir(dirname(qrFile));
  ensurePrivateDir(profile);
  const claimedBrowserLock = (() => {
    try {
      const lock = JSON.parse(readFileSync(browserLock, "utf8"));
      if (lock.flowId !== flowId) return false;
      writeAtomic(browserLock, { ...lock, pid: process.pid, updatedAt: now() });
      return true;
    } catch {
      return false;
    }
  })();
  if (!claimedBrowserLock) {
    updateState({ status: "error", error: "登录浏览器会话锁不可用，请重试。" });
    await stop(1);
    return;
  }
  const browser = findBrowser();
  if (!browser) {
    updateState({ status: "error", error: "未找到 Chrome 或 Chromium，请安装浏览器后重试。" });
    await stop(1);
    return;
  }
  updateState({ status: "starting", pid: process.pid, browser });
  context = await chromium.launchPersistentContext(profile, {
    executablePath: browser,
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20_000);
  const readToken = async () => {
    try {
      const response = await page.request.post("https://www.zhixue.com/container/app/token/getToken", { data: {} });
      return extractToken(await response.json());
    } catch { return ""; }
  };
  await page.goto("https://www.zhixue.com/login.html", { waitUntil: "domcontentloaded", timeout: 30_000 });
  let token = await readToken();
  if (!token) {
    const switcher = page.locator("#loginSwitch div").filter({ hasText: "扫码登录" });
    if (await switcher.count()) await switcher.first().click().catch(() => {});
    const qr = page.locator("#qrCode img");
    await qr.waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(() => {
      const image = document.querySelector("#qrCode img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    }, null, { timeout: 15_000 });
    writeFileSync(qrFile, await page.locator("#qrCode").screenshot(), { mode: 0o600 });
    updateState({ status: "awaiting_scan", qrPath: qrFile });
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline && !stopping) {
      token = await readToken();
      if (token) break;
      await page.waitForTimeout(2_000);
    }
  }
  if (!token) {
    updateState({ status: "expired", error: "扫码等待超时，请重新发起登录。" });
    await stop(2);
    return;
  }
  await page.waitForTimeout(1_500);
  const cookies = await context.cookies();
  writeAtomic(sessionFile, { version: 1, flowId, token, cookies, authenticatedAt: now() });
  writeAtomic(join(dirname(sessionFile), "login_ok.json"), { version: 1, flowId, authenticatedAt: now() });
  updateState({ status: "authenticated", authenticatedAt: now() });
  await stop(0);
})().catch(async error => {
  updateState({ status: "error", error: error instanceof Error ? error.message : String(error) });
  await stop(1);
});
