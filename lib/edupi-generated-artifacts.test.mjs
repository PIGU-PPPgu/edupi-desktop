import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { snapshotGeneratedFiles, generatedArtifactsRequest, recoverSessionArtifacts, resolveArtifactRegistrationFields, completedSessionFiles, nativeToolArtifactPath, writtenToolArtifactPath } = await jiti.import("./edupi-generated-artifacts.ts");
const { bindTaskSessionFile, taskSessionFile } = await jiti.import("./edupi-task-session-store.ts");

test("artifact registration fills a missing task id from the bound session", async () => {
  const calls = [];
  const fields = await resolveArtifactRegistrationFields(
    { action: "register", file_path: "/tmp/lesson.md", session_id: "session-1" },
    async sessionId => { calls.push(sessionId); return "task-1"; },
  );
  assert.deepEqual(fields, { action: "register", file_path: "/tmp/lesson.md", session_id: "session-1", task_id: "task-1" });
  assert.deepEqual(calls, ["session-1"]);
  assert.deepEqual(await resolveArtifactRegistrationFields({ action: "register", session_id: "session-1", task_id: "explicit-task" }, async () => { throw new Error("lookup should not run"); }), { action: "register", session_id: "session-1", task_id: "explicit-task" });
});

test("concurrent background sessions keep bash snapshots and completed writes in their own job", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-concurrent-artifacts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const jobs = ["first", "second"].map(id => {
    const directory = path.join(root, ".edupi/output/agent-computer", id);
    fs.mkdirSync(directory, { recursive: true });
    return { directory, file: path.join(directory, "lesson.txt"), pending: new Map(), before: snapshotGeneratedFiles(root, directory) };
  });
  // Both sessions start before either file is written; the second finishes first.
  for (const job of jobs) writtenToolArtifactPath({ type: "tool_execution_start", toolCallId: "write-1", toolName: "write", args: { path: job.file } }, root, job.pending);
  await Promise.all(jobs.map(job => fs.promises.writeFile(job.file, job.directory)));
  for (const job of [...jobs].reverse()) {
    const result = writtenToolArtifactPath({ type: "tool_execution_end", toolCallId: "write-1", toolName: "write", isError: false }, root, job.pending);
    assert.equal(result, job.file);
    assert.equal(job.pending.size, 0);
    const changed = [...snapshotGeneratedFiles(root, job.directory)].filter(([file, stamp]) => job.before.get(file) !== stamp).map(([file]) => file);
    assert.deepEqual(changed, [job.file]);
  }
  const pending = jobs[0].pending;
  writtenToolArtifactPath({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit", args: { path: ".edupi/output/failed.txt" } }, root, pending);
  assert.equal(writtenToolArtifactPath({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit", isError: true }, root, pending), null);
  assert.equal(pending.size, 0);
  assert.equal(writtenToolArtifactPath({ type: "tool_execution_end", toolCallId: "unknown", toolName: "read", isError: false }, root, pending), null);
  writtenToolArtifactPath({ type: "tool_execution_start", toolCallId: "config", toolName: "write", args: { path: "config.json" } }, root, pending);
  assert.equal(writtenToolArtifactPath({ type: "tool_execution_end", toolCallId: "config", toolName: "write", isError: false }, root, pending), null);
});

test("native tool completion reads result details without requiring execution arguments", () => {
  for (const [toolName, extension] of [["edupi_make_document", "docx"], ["edupi_make_ppt", "pptx"], ["try_teaching_method", "md"]]) {
    const file = `/tmp/project/.edupi/output/a/b/c/d/e/f/g/lesson.${extension}`;
    const event = { type: "tool_execution_end", toolCallId: "native", toolName, result: { content: [{ type: "text", text: "完成" }], details: { path: file } }, isError: false };
    assert.equal(nativeToolArtifactPath(event), file);
    assert.equal(nativeToolArtifactPath({ ...event, isError: true }), null);
    assert.equal(nativeToolArtifactPath({ ...event, toolName: "write" }), null);
    assert.equal(nativeToolArtifactPath({ ...event, type: "tool_execution_update" }), null);
    assert.equal(nativeToolArtifactPath({ ...event, result: { content: [] } }), null);
  }
});

test("native document tool outputs can be recovered from completed history",()=>{
  const entries=[{message:{role:"assistant",content:[{type:"toolCall",id:"doc",name:"edupi_make_document",arguments:{path:".edupi/output/a.docx"}}]}},{message:{role:"toolResult",toolCallId:"doc",isError:false}}];
  assert.deepEqual(completedSessionFiles(entries,"/tmp/project"),["/tmp/project/.edupi/output/a.docx"]);
  entries[1].message.isError=true;
  assert.deepEqual(completedSessionFiles(entries,"/tmp/project"),[]);
});

test("history recovery uses successful file writes rather than assistant claims", () => {
  const entries = [
    { message: { role: "assistant", content: [{ type: "text", text: "Created phantom.md" }, { type: "toolCall", id: "a", name: "write", arguments: { path: "lesson.md" } }, { type: "toolCall", id: "b", name: "write", arguments: { path: "failed.md" } }] } },
    { message: { role: "toolResult", toolCallId: "a", isError: false } },
    { message: { role: "toolResult", toolCallId: "b", isError: true } },
  ];
  assert.deepEqual(completedSessionFiles(entries, "/tmp/project"), ["/tmp/project/lesson.md"]);
});

test("history recovery uses native result paths and never failed or unrelated results", () => {
  const entries = [
    { message: { role: "assistant", content: [
      { type: "toolCall", id: "method", name: "try_teaching_method", arguments: {} },
      { type: "toolCall", id: "doc", name: "edupi_make_document", arguments: { path: "requested.docx" } },
      { type: "toolCall", id: "fail", name: "edupi_make_ppt", arguments: {} },
      { type: "toolCall", id: "read", name: "read", arguments: {} },
    ] } },
    { message: { role: "toolResult", toolCallId: "method", details: { path: "output/method.md" } } },
    { message: { role: "toolResult", toolCallId: "doc", details: { path: "output/actual.docx" } } },
    { message: { role: "toolResult", toolCallId: "fail", isError: true, details: { path: "output/failed.pptx" } } },
    { message: { role: "toolResult", toolCallId: "read", details: { path: "output/unrelated.md" } } },
  ];
  assert.deepEqual(completedSessionFiles(entries, "/tmp/project"), ["/tmp/project/output/method.md", "/tmp/project/output/actual.docx"]);
});

test("output snapshot detects new and revised teaching documents without scanning memory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-output-test-"));
  try {
    fs.mkdirSync(path.join(root, "deliverables"));
    fs.mkdirSync(path.join(root, ".edupi/memory"), { recursive: true });
    fs.writeFileSync(path.join(root, ".edupi/memory/private.md"), "private");
    assert.equal(snapshotGeneratedFiles(root).size, 0);
    const file = path.join(root, "deliverables/lesson.docx");
    fs.writeFileSync(file, "first");
    const before = snapshotGeneratedFiles(root);
    fs.writeFileSync(file, "revised document");
    assert.notEqual(snapshotGeneratedFiles(root).get(file), before.get(file));
    assert.equal(snapshotGeneratedFiles(root).size, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("real Core process registers and reads a generated file across separate invocations", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-artifact-bridge-"));
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-artifact-agent-"));
  const oldRoot = process.env.EDUPI_DATA_ROOT;
  const oldAllowed = process.env.EDUPI_DATA_ALLOWED_ROOT;
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.EDUPI_DATA_ROOT = root;
  process.env.EDUPI_DATA_ALLOWED_ROOT = os.tmpdir();
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const file = path.join(root, "lesson.md");
    fs.writeFileSync(file, "# 教案");
    await bindTaskSessionFile(taskSessionFile(root), { taskId: "task-test", sessionId: "test-session" });
    const response = await generatedArtifactsRequest("register", { file_path: file, session_id: "test-session" });
    const read = await generatedArtifactsRequest("list");
    assert.equal(read.artifacts[0].artifact_id, response.artifact.artifact_id);
    assert.equal(read.artifacts[0].title, "lesson.md");
    assert.equal(read.artifacts[0].task_id, "task-test");
    const recoveredFile = path.join(root, "method.md");
    fs.writeFileSync(recoveredFile, "# 教学方法验收\n分层练习");
    const sessionFile = path.join(root, "history.jsonl");
    fs.writeFileSync(sessionFile, [
      { message: { role: "assistant", content: [{ type: "toolCall", id: "native", name: "try_teaching_method", arguments: {} }] } },
      { message: { role: "toolResult", toolCallId: "native", details: { path: recoveredFile }, isError: false } },
    ].map(item => JSON.stringify(item)).join("\n"));
    assert.deepEqual(await recoverSessionArtifacts(sessionFile, root, "recovery-session"), { registered: 1, failedCount: 0 });
    const recovered = (await generatedArtifactsRequest("list")).artifacts.find(item => item.relative_path === "method.md");
    assert.equal(recovered.session_id, "recovery-session");
    await recoverSessionArtifacts(sessionFile, root, "recovery-session");
    assert.equal((await generatedArtifactsRequest("list")).artifacts.filter(item => item.relative_path === "method.md").length, 1);
  } finally {
    if (oldRoot === undefined) delete process.env.EDUPI_DATA_ROOT; else process.env.EDUPI_DATA_ROOT = oldRoot;
    if (oldAllowed === undefined) delete process.env.EDUPI_DATA_ALLOWED_ROOT; else process.env.EDUPI_DATA_ALLOWED_ROOT = oldAllowed;
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});
