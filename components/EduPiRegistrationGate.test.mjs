import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gate = await readFile(new URL("./EduPiRegistrationGate.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/edupi-welcome.css", import.meta.url), "utf8");

test("the desktop opens directly while the registration gate stays dormant", () => {
  assert.match(page, /<I18nProvider initialLocale="zh-CN">\s*<AppShell \/>\s*<\/I18nProvider>/);
  assert.doesNotMatch(page, /EduPiRegistrationGate|readEduPiRegistration|initialRegistered/);
  assert.match(gate, /initialRegistered === true \? "ready"/);
  assert.match(gate, /fetchWithRetry\("\/api\/edupi\/registration"/);
  assert.match(gate, /type="password"/);
  assert.match(gate, /autoComplete="one-time-code"/);
  assert.match(gate, /maxLength=\{128\}/);
  assert.match(gate, /role="alert"/);
  assert.match(gate, /: "继续"/);
  assert.match(gate, /if \(status === 429\) return "一分钟后再试"/);
  assert.match(gate, /registrationErrorMessage\(response\.status\)/);
});

test("the first launch directionally reveals solid handwriting before one minimal action", () => {
  assert.match(gate, /<h1[^>]*>欢迎使用 EduPi<\/h1>/);
  assert.match(gate, /className=\{`edupi-welcome-wordmark\$\{started \? " is-writing" : ""\}`\}/);
  assert.match(gate, /className="edupi-welcome-brush is-5"[\s\S]*onAnimationEnd=\{finishWriting\}/);
  assert.match(gate, /clipPath="url\(#edupi-welcome-clip-5\)"/);
  assert.match(gate, /animationName === "edupi-color-settle"[\s\S]*onComplete\(\)/);
  assert.match(gate, /className=\{`edupi-welcome-ink\$\{coloring \? " is-coloring" : ""\}`\}/);
  assert.match(gate, /event\.animationName === "edupi-handwrite"/);
  assert.match(gate, /<WelcomeWordmark started=\{sequenceStarted\} onComplete=\{revealWelcomeAccess\} \/>/);
  assert.match(gate, /requestAnimationFrame\(\(\) => \{[\s\S]*setSequenceStarted\(true\)/);
  assert.match(gate, /setTimeout\(revealWelcomeAccess, 6_500\)/);
  assert.match(gate, /cancelAnimationFrame\(sequenceFrameRef\.current\)/);
  assert.match(gate, /revealAccess/);
  assert.match(gate, /placeholder="邀请码"/);
  assert.match(css, /@keyframes edupi-handwrite/);
  assert.match(css, /@keyframes edupi-color-settle/);
  assert.match(css, /\.edupi-welcome-brush[\s\S]*transform: scaleX\(0\)/);
  assert.match(css, /\.edupi-welcome-wordmark\.is-writing \.edupi-welcome-brush/);
  assert.doesNotMatch(gate + css, /WELCOME_SEQUENCE_MS|revealRef|glyph-stroke|stroke-dash/);
  assert.doesNotMatch(gate, /EduPiParticleField|edupi-welcome-grid|edupi-welcome-story|edupi-registration-card/);
  assert.doesNotMatch(gate, /把教师的一天|校历先行|材料即入口|教师最后确认|WELCOME TO EDUPI|FIRST ACCESS|教师智能体桌面/);
});

test("the handwritten welcome restores focus and follows explicit theme and accessibility modes", () => {
  assert.match(gate, /prefers-reduced-motion: reduce/);
  assert.match(gate, /setRevealAccess\(true\)/);
  assert.match(gate, /inputRef\.current\?\.focus\(\)/);
  assert.match(gate, /retryRef\.current\?\.focus\(\)/);
  assert.match(gate, /ref=\{inputRef\}/);
  assert.match(gate, /ref=\{retryRef\}/);
  assert.match(gate, /<label[^>]*htmlFor="edupi-invite-code"/);
  assert.match(gate, /<svg[^>]*aria-hidden="true"/);
  assert.match(css, /html\.dark \.edupi-welcome/);
  assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /--welcome-focus: #006edc/);
  assert.match(css, /--welcome-muted: #626267/);
  assert.match(gate, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(gate, /dangerouslySetInnerHTML|innerHTML/);
});
