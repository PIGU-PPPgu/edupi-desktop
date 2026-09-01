import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("teaching priorities open the existing global AI conversation instead of file upload", async () => {
  const [teaching, views, panel] = await Promise.all([
    read("./EduPiTeachingWorkspace.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("./EduPiEducationPanel.tsx"),
  ]);

  assert.match(teaching, /buildTeachingPriorityConversationPrompt/);
  assert.match(teaching, />对话补充重点<\/button>/);
  assert.match(teaching, /onStartAgent\(priorityPrompt, "replace"\)/);
  assert.doesNotMatch(teaching, /onClick=\{onUpload\}>导入教学重点/);
  assert.doesNotMatch(teaching, /onUpload:/);
  assert.match(views, /mode\?: "insert" \| "replace"/);
  assert.match(panel, /onStartAgent=\{\(prompt, mode\) => startAgent\(prompt, mode\)\}/);
});

test("the global chat composer exposes optional, non-sending dictation", async () => {
  const [chatInput, dictationHook, zh, en, macInfo] = await Promise.all([
    read("./ChatInput.tsx"),
    read("../hooks/useSpeechDictation.ts"),
    read("../lib/i18n/messages/zh-CN.ts"),
    read("../lib/i18n/messages/en.ts"),
    read("../src-tauri/Info.plist"),
  ]);

  assert.match(chatInput, /useSpeechDictation/);
  assert.match(chatInput, /aria-pressed=\{dictation\.listening\}/);
  assert.match(chatInput, /dictation\.toggle/);
  assert.doesNotMatch(chatInput, /dictation[\s\S]{0,200}handleSend\(/);
  assert.match(dictationHook, /setListening\(true\);\s*try\s*\{\s*recognition\.start\(\)/s);
  for (const key of ["chat.startDictation", "chat.stopDictation", "chat.dictationError"]) {
    assert.match(zh, new RegExp(key.replace(".", "\\.")));
    assert.match(en, new RegExp(key.replace(".", "\\.")));
  }
  assert.match(macInfo, /NSMicrophoneUsageDescription/);
  assert.match(macInfo, /NSSpeechRecognitionUsageDescription/);
});
