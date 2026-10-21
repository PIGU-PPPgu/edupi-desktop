import type { EduPiMaterialLessonProposal, EduPiMaterialChapterSuggestion } from "./edupi-core-process-client";

export type DocxSourceSpan = { path: string; start: number; end: number };
export type DocxSourcePreview = { version: 1; format: "docx"; status: "ready" | "held"; basis_hash: string;
  material_id?: string; source_hash?: string; record_hash?: string; read_only?: true; external_send?: false;
  blocks: Array<{ path: string; text: string; cells?: Array<{ path: string; text: string }> }>;
  issues: Array<{ code: string; path?: string }> };
type ReadyProposal = Extract<EduPiMaterialLessonProposal, { status: "proposed" }> & {
  chapter_suggestion: Extract<EduPiMaterialChapterSuggestion, { status: "ready" }>;
};
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const boundary = (text: string, offset: number) => !(offset > 0 && offset < text.length
  && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
  && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

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
  if (!preview || preview.version !== 1 || preview.format !== "docx" || preview.status !== "ready"
    || preview.material_id !== materialId || preview.source_hash !== proposal.source_hash
    || !hash(preview.basis_hash) || !hash(preview.record_hash) || preview.read_only !== true || preview.external_send !== false
    || !Array.isArray(preview.issues) || preview.issues.length || !Array.isArray(preview.blocks)) fail();
  const chapter = proposal.chapter_suggestion;
  if (!chapter.title || chapter.title.length > 160 || chapter.reason_code !== null || !hash(chapter.content_hash)
    || !Array.isArray(chapter.source_spans) || !chapter.source_spans.length || chapter.source_spans.length > 20) fail();
  const leaves = preview.blocks.flatMap(block => block.cells === undefined ? [block] : block.cells);
  if (leaves.some((leaf, index) => typeof leaf.path !== "string" || typeof leaf.text !== "string"
    || leaves.findIndex(item => item.path === leaf.path) !== index)) fail();
  let previousOrder = -1, previousEnd = 0;
  const parts = chapter.source_spans.map(span => {
    if (!span || Object.keys(span).sort().join("|") !== "end|path|start" || typeof span.path !== "string"
      || !span.path.startsWith("word/document.xml/w:document[0]/w:body[0]/") || span.path.length > 240
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
