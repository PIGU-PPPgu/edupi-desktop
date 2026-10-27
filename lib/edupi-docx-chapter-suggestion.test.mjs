import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const { currentMaterialSourcePreview, materialSourceIssueMessage, resolveDocxChapterSelection } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-docx-chapter-suggestion.ts");
const hash = value => "sha256:" + createHash("sha256").update(value).digest("hex");
function fixture(format) {
  const path = format === "pdf" ? "pdf/page[2]/line[1]" : "image/line[0]", text = "章节：方程😀";
  const preview = { version: 1, format, status: "ready", material_id: "material-current", source_hash: hash("bytes"),
    record_hash: hash("record"), basis_hash: hash("basis"), read_only: true, external_send: false, issues: [],
    blocks: [{ path, text, page: format === "pdf" ? 2 : 1, region: { left: 12, top: 30, width: 800, height: 60 } }],
    ...(format === "image" ? { source_review_required: "image_text" } : {}) };
  const proposal = { status: "proposed", material_id: preview.material_id, metadata_revision: 2, source_hash: preview.source_hash,
    read_only: true, automatic_prepare: false, external_send: false, chapter_suggestion: { status: "ready", title: "方程",
      source_spans: [{ path, start: 3, end: text.length }], content_hash: hash("方程😀"), reason_code: null, read_only: true, requires_review: true } };
  return { preview, proposal };
}

test("current PDF/image chapters preserve source coordinates and exact UTF-16 selection", async () => {
  for (const format of ["pdf", "image"]) {
    const { preview, proposal } = fixture(format);
    assert.equal(currentMaterialSourcePreview(preview, preview.material_id), true);
    const selected = await resolveDocxChapterSelection(preview, proposal, preview.material_id, 2, true);
    assert.equal(selected.content, "方程😀"); assert.deepEqual(selected.spans, proposal.chapter_suggestion.source_spans);
  }
});

test("Core held reasons stay specific when native extraction supplied only a generic message", () => {
  assert.equal(materialSourceIssueMessage({ code: "pdf_native_page_limit", message: "材料可见内容无法核实。" }), "PDF 页数超过3页");
  assert.equal(materialSourceIssueMessage({ code: "pdf_native_text_mismatch" }), "PDF 文字与可见内容不一致");
  assert.equal(materialSourceIssueMessage({ code: "future_held_reason", message: "材料可见内容无法核实。" }), "future_held_reason");
  assert.equal(materialSourceIssueMessage({ code: "missing_time_zone", message: "缺少时区" }), "缺少时区");
});

test("invalid visual page/region, review flags, foreign material and changed content fail closed", async () => {
  for (const patch of [value => { value.blocks[0].page = 1; }, value => { value.blocks[0].region.width = 0; },
    value => { value.blocks[0].region.left = 10000; }, value => { value.blocks[0].region.width = 1000; value.blocks[0].region.height = 6000; },
    value => { value.blocks[0].path = "word/document.xml/w:p[0]"; }, value => { value.source_review_required = "caller_verified"; },
    value => { value.material_id = "foreign"; }]) {
    const { preview } = fixture("pdf"); patch(preview);
    assert.equal(currentMaterialSourcePreview(preview, "material-current"), false);
  }
  const image = fixture("image").preview; delete image.source_review_required;
  assert.equal(currentMaterialSourcePreview(image, image.material_id), false);
  const { preview, proposal } = fixture("pdf"); preview.blocks[0].text = "章节：变更😀";
  await assert.rejects(resolveDocxChapterSelection(preview, proposal, preview.material_id, 2, true), /章节建议已变化/);
});
