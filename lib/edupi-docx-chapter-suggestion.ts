import type { EduPiMaterialLessonProposal, EduPiMaterialChapterSuggestion } from "./edupi-core-process-client";

export type DocxSourceSpan = { path: string; start: number; end: number };
export type DocxSourceRegion = { left: number; top: number; width: number; height: number };
export type DocxSourceBlock = { path: string; text: string; cells?: Array<{ path: string; text: string }>;
  page?: number; region?: DocxSourceRegion };
export type DocxSourcePreview = { version: 1; format: "docx" | "pdf" | "image"; status: "ready" | "held"; basis_hash: string;
  material_id?: string; source_hash?: string; record_hash?: string; read_only?: true; external_send?: false;
  blocks: DocxSourceBlock[]; source_review_required?: "image_text";
  issues: Array<{ code: string; path?: string; message?: string }> };
type ReadyProposal = Extract<EduPiMaterialLessonProposal, { status: "proposed" }> & {
  chapter_suggestion: Extract<EduPiMaterialChapterSuggestion, { status: "ready" }>;
};
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const boundary = (text: string, offset: number) => !(offset > 0 && offset < text.length
  && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
  && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

export function materialSourceIssueMessage(issue: { code: string; message?: string }): string {
  const messages: Record<string, string> = {
    pdf_native_page_limit: "PDF 页数超过3页",
    pdf_native_text_limit: "PDF 单页文字超出处理范围",
    pdf_native_text_mismatch: "PDF 文字与可见内容不一致",
    pdf_native_missing_text: "PDF 文字暂时无法核实",
    image_native_no_text: "图片未识别到文字",
    visual_source_deadline: "材料读取超时",
    visual_source_macos_only: "请在 macOS 桌面中核对材料",
    visual_source_host_unsupported: "当前 macOS 版本暂不支持材料核对",
  };
  return Object.hasOwn(messages, issue.code) ? messages[issue.code]
    : issue.message && issue.message !== "材料可见内容无法核实。" ? issue.message : issue.code;
}

export function currentMaterialSourcePreview(value: unknown, materialId: string): value is DocxSourcePreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as DocxSourcePreview;
  const textBlock = (block: { path: string; text: string }) => block && typeof block.path === "string"
    && block.path.length > 0 && block.path.length <= 2048 && typeof block.text === "string" && block.text.length <= 4096;
  return item.version === 1 && ["docx", "pdf", "image"].includes(item.format) && ["ready", "held"].includes(item.status)
    && item.material_id === materialId && hash(item.basis_hash) && hash(item.source_hash) && hash(item.record_hash)
    && item.read_only === true && item.external_send === false
    && (item.source_review_required === undefined || item.format === "image" && item.source_review_required === "image_text")
    && (item.status !== "ready" || item.format !== "image" || item.source_review_required === "image_text")
    && Array.isArray(item.blocks) && item.blocks.length <= (item.format === "docx" ? 1000 : 60)
    && item.blocks.every(block => {
      if (!textBlock(block)) return false;
      if (item.format === "docx") return block.page === undefined && block.region === undefined
        && (block.cells === undefined || Array.isArray(block.cells) && block.cells.length <= 1000 && block.cells.every(textBlock));
      const region = block.region;
      return block.cells === undefined && Number.isSafeInteger(block.page)
        && (item.format === "pdf" ? /^pdf\/page\[[1-3]\]\/line\[(?:[0-9]|1[0-9])\]$/u.test(block.path)
          && block.path.startsWith(`pdf/page[${block.page}]/`)
          : /^image\/line\[(?:[0-9]|[1-5][0-9])\]$/u.test(block.path) && block.page === 1)
        && Boolean(region && Object.keys(region).sort().join("|") === "height|left|top|width"
          && Object.values(region).every(Number.isSafeInteger) && region.left >= 0 && region.top >= 0
          && region.width > 0 && region.height > 0 && region.width * region.height <= 5_000_000
          && region.left + region.width <= 10000 && region.top + region.height <= 10000);
    }) && Array.isArray(item.issues) && item.issues.length <= 200 && (item.status === "held") === (item.issues.length > 0)
    && item.issues.every(issue => issue && typeof issue.code === "string" && issue.code.length > 0 && issue.code.length <= 80
      && (issue.path === undefined || typeof issue.path === "string" && issue.path.length <= 2048)
      && (issue.message === undefined || typeof issue.message === "string" && issue.message.length <= 4096));
}

export function currentDocxChapter(proposal: EduPiMaterialLessonProposal | undefined, materialId: string,
  metadataRevision: number | undefined, available: boolean): proposal is ReadyProposal {
  return Boolean(available && proposal?.status === "proposed" && proposal.material_id === materialId
    && proposal.metadata_revision === metadataRevision && Number.isSafeInteger(metadataRevision)
    && proposal.read_only === true && proposal.automatic_prepare === false && proposal.external_send === false
    && hash(proposal.source_hash) && proposal.chapter_suggestion?.status === "ready"
    && proposal.chapter_suggestion.read_only === true && proposal.chapter_suggestion.requires_review === true);
}

export async function resolveDocxChapterSelection(preview: DocxSourcePreview, proposal: EduPiMaterialLessonProposal | undefined,
  materialId: string, metadataRevision: number | undefined, available: boolean) {
  const fail = (): never => { throw new Error("章节建议已变化，请重新核对原文"); };
  if (!currentDocxChapter(proposal, materialId, metadataRevision, available)) return fail();
  if (!currentMaterialSourcePreview(preview, materialId) || preview.status !== "ready"
    || preview.source_hash !== proposal.source_hash) fail();
  const chapter = proposal.chapter_suggestion;
  if (!chapter.title || chapter.title.length > 160 || chapter.reason_code !== null || !hash(chapter.content_hash)
    || !Array.isArray(chapter.source_spans) || !chapter.source_spans.length || chapter.source_spans.length > 20) fail();
  const leaves = preview.blocks.flatMap(block => block.cells === undefined ? [block] : block.cells);
  if (leaves.some((leaf, index) => typeof leaf.path !== "string" || typeof leaf.text !== "string"
    || leaves.findIndex(item => item.path === leaf.path) !== index)) fail();
  let previousOrder = -1, previousEnd = 0;
  const parts = chapter.source_spans.map(span => {
    if (!span || Object.keys(span).sort().join("|") !== "end|path|start" || typeof span.path !== "string"
      || (preview.format === "docx" && !span.path.startsWith("word/document.xml/w:document[0]/w:body[0]/")) || span.path.length > 240
      || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)) fail();
    const order = leaves.findIndex(item => item.path === span.path), leaf = leaves[order];
    if (!leaf || span.start < 0 || span.end <= span.start || span.end > leaf.text.length
      || !boundary(leaf.text, span.start) || !boundary(leaf.text, span.end)
      || order < previousOrder || order === previousOrder && span.start < previousEnd) fail();
    previousOrder = order; previousEnd = span.end;
    const text = leaf.text.slice(span.start, span.end);
    if (!text.trim()) fail();
    return text;
  });
  const content = parts.join("\n"), bytes = new TextEncoder().encode(content);
  if (bytes.length > 16_384) fail();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contentHash = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (contentHash !== chapter.content_hash) fail();
  return { spans: chapter.source_spans.map(span => ({ ...span })), parts, content };
}
