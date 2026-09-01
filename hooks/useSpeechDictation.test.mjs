import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { appendSpeechTranscript, finalSpeechTranscript, speechRecognitionConstructor } = await jiti.import("./useSpeechDictation.ts");

test("appends final dictation without changing or sending the existing draft", () => {
  assert.equal(appendSpeechTranscript("", "  最近要关注移项  "), "最近要关注移项");
  assert.equal(appendSpeechTranscript("七年级数学", "重点关注符号"), "七年级数学 重点关注符号");
  assert.equal(appendSpeechTranscript("已有内容\n", "继续补充"), "已有内容\n继续补充");
});

test("resolves standard and prefixed browser speech recognition constructors", () => {
  class StandardRecognition {}
  class PrefixedRecognition {}
  assert.equal(speechRecognitionConstructor({ SpeechRecognition: StandardRecognition }), StandardRecognition);
  assert.equal(speechRecognitionConstructor({ webkitSpeechRecognition: PrefixedRecognition }), PrefixedRecognition);
  assert.equal(speechRecognitionConstructor({}), null);
});

test("keeps only final speech results from the event result index", () => {
  const event = {
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: "旧结果" } },
      { isFinal: false, 0: { transcript: "临时结果" } },
      { isFinal: true, 0: { transcript: "重点关注移项" } },
      { isFinal: true, 0: { transcript: "补一次当堂检查" } },
    ],
  };
  assert.equal(finalSpeechTranscript(event), "重点关注移项 补一次当堂检查");
});
