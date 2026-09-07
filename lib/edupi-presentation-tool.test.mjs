import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { createEduPiPresentationTool } = await jiti.import("./edupi-presentation-tool.ts");

test("native presentation tool writes a real deck and rejects paths outside outputs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-presentation-"));
  try {
    const tool = createEduPiPresentationTool(root);
    const input = { title: "测试课件", path: ".edupi/output/test.pptx", slides: [{ title: "认识几何体", points: ["观察长方体", "比较球与圆柱"] }, { title: "练习", points: ["找出身边的几何体"] }] };
    const result = await tool.execute("test", input, undefined, undefined, { cwd: root });
    const zip = await JSZip.loadAsync(fs.readFileSync(result.details.path));
    assert.ok(zip.file("[Content_Types].xml"));
    assert.ok(zip.file("ppt/presentation.xml"));
    assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), /认识几何体/);
    assert.ok(zip.file("ppt/slides/slide2.xml"));
    await assert.rejects(tool.execute("bad", { ...input, path: "../outside.pptx" }, undefined, undefined, { cwd: root }), /输出目录/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
