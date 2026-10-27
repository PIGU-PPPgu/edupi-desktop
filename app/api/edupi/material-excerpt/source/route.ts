import { NextResponse } from "next/server";
import { readEducationContract } from "@/lib/edupi-education-server";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { currentMaterialSourcePreview, type DocxSourcePreview, type DocxSourceRegion } from "@/lib/edupi-docx-chapter-suggestion";

export const dynamic = "force-dynamic";
type Span = { path: string; start: number; end: number };
type Preview = DocxSourcePreview;
type Excerpt = { material_id: string; revision: number; status: "confirmed" | "withdrawn"; content: string;
  source_kind?: "docx_parsed_fragment" | "pdf_visible_fragment" | "image_reviewed_fragment" | "teacher_curated";
  basis_hash?: string; source_hash?: string; record_hash?: string;
  source_spans?: Array<Span & { page?: number; region?: DocxSourceRegion }> };
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const fail = (code: string) => Object.assign(new Error(code), { code });

async function scope(materialId: unknown) {
  if (typeof materialId !== "string" || !materialId.trim() || materialId.length > 160) throw fail("invalid_input");
  const data = await readEducationContract();
  const material = data.teacherMaterials?.find(item => item.material_id === materialId);
  if (!material || material.available === false) throw fail("material_unavailable");
  if (!material.subject?.trim() || !material.class_id?.trim()) throw fail("scope_missing");
  return { materialId, subject: material.subject, classId: material.class_id };
}

async function invoke(action: "source_preview" | "review_source" | "read", input: Record<string, unknown>, signal: AbortSignal) {
  const roots = resolveEduPiBridgeRoots();
  // Source proof is bound to the managed Core owner and writer admission; a
  // standalone bridge process has neither and must not be promoted to authority.
  await ensureEduPiRuntime(roots);
  const result = await runCoreProcess<{ ok: boolean; code?: string; excerpt?: Preview | Excerpt | null }>({
    ...roots, timeoutMs: 20_000, signal,
    request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop",
      request_id: crypto.randomUUID(), operation: "g1-excerpt", action, input },
  });
  if (!result.ok) throw fail(result.code || "unavailable");
  return result.excerpt;
}

function selectionReadbackMatches(preview: Preview, selectors: Span[], excerpt: Excerpt): boolean {
  const kind = { docx: "docx_parsed_fragment", pdf: "pdf_visible_fragment", image: "image_reviewed_fragment" }[preview.format];
  if (excerpt.source_kind !== kind || !Array.isArray(excerpt.source_spans) || excerpt.source_spans.length !== selectors.length) return false;
  const leaves = preview.blocks.flatMap(block => block.cells === undefined ? [block] : block.cells);
  const parts: string[] = [];
  for (let index = 0; index < selectors.length; index++) {
    const selected = selectors[index], current = excerpt.source_spans[index];
    const matches = leaves.filter(block => block.path === selected.path), block = matches[0];
    if (matches.length !== 1 || !current || current.path !== selected.path || current.start !== selected.start || current.end !== selected.end
      || selected.end > block.text.length) return false;
    if (preview.format === "docx") {
      if (Object.keys(current).sort().join("|") !== "end|path|start") return false;
    } else {
      const visual = block as Preview["blocks"][number], region = current.region;
      if (Object.keys(current).sort().join("|") !== "end|page|path|region|start" || current.page !== visual.page
        || !region || Object.keys(region).sort().join("|") !== "height|left|top|width"
        || !visual.region || (Object.keys(visual.region) as Array<keyof DocxSourceRegion>).some(key => region[key] !== visual.region![key])) return false;
    }
    parts.push(block.text.slice(selected.start, selected.end));
  }
  return parts.join("\n") === excerpt.content;
}

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "所选内容过多" }, { status: 413 });
  const code = (error as { code?: string })?.code;
  if (["invalid_input", "invalid_review", "docx_fragment_invalid"].includes(code || "")) return NextResponse.json({ error: "所选原文无效，请重新选择" }, { status: 400 });
  if (["stale_source", "stale_revision"].includes(code || "")) return NextResponse.json({ error: "材料已变化，请刷新原文后重新核对", conflict: true }, { status: 409 });
  if (code === "docx_fragment_held") return NextResponse.json({ error: "原文有待核对内容，不能直接确认片段" }, { status: 409 });
  if (code === "docx_fragment_unsupported") return NextResponse.json({ error: "该材料格式暂不支持原文选取" }, { status: 415 });
  if (code === "docx_fragment_capacity") return NextResponse.json({ error: "文档或选中内容超出处理范围" }, { status: 413 });
  if (code === "material_unavailable" || code === "source_unavailable") return NextResponse.json({ error: "材料已不可用" }, { status: 404 });
  if (code === "scope_missing") return NextResponse.json({ error: "请先设置材料的学科和班级" }, { status: 409 });
  if (code === "docx_fragment_authority" || code === "permission_denied") return NextResponse.json({ error: "当前工作区无权确认此材料" }, { status: 403 });
  if (code === "readback_unconfirmed") return NextResponse.json({ error: "确认结果未核实，请核对最新版本" }, { status: 503 });
  if (code === "material_document_deadline") return NextResponse.json({ error: "原文读取超时，请重试", code }, { status: 503 });
  if (code === "material_document_busy") return NextResponse.json({ error: "原文正在读取，请稍后重试", code }, { status: 503 });
  return NextResponse.json({ error: "原文读取或确认未完成，请重试", ...(code ? { code } : {}) }, { status: 503 });
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const input = await scope(new URL(request.url).searchParams.get("materialId"));
    const preview = await invoke("source_preview", input, request.signal);
    if (!currentMaterialSourcePreview(preview, input.materialId)) throw fail("invalid_response");
    return NextResponse.json({ preview });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 100_000) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || !["expectedBasisHash", "expectedRevision", "materialId", "sourceSpans"].every(key => Object.hasOwn(body, key))
      || Object.keys(body).some(key => !["expectedBasisHash", "expectedRevision", "materialId", "sourceSpans", "confirmSourceText"].includes(key))
      || Object.hasOwn(body, "confirmSourceText") && body.confirmSourceText !== true
      || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || !hash(body.expectedBasisHash)
      || !Array.isArray(body.sourceSpans) || body.sourceSpans.length < 1 || body.sourceSpans.length > 20
      || body.sourceSpans.some((span: unknown) => {
        const item = span as Span | null;
        return !item || typeof item !== "object" || Object.keys(item).sort().join("|") !== "end|path|start"
          || typeof item.path !== "string" || item.path.length < 1 || item.path.length > 2048
          || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start || item.end > 4096;
      })) throw fail("invalid_input");
    const input = await scope(body.materialId);
    const current = await invoke("read", input, request.signal) as Excerpt | null;
    if ((current?.revision ?? 0) !== body.expectedRevision) throw fail("stale_revision");
    await invoke("review_source", { ...input, expectedRevision: body.expectedRevision,
      expectedBasisHash: body.expectedBasisHash, sourceSpans: body.sourceSpans, reviewer: "teacher",
      ...(body.confirmSourceText === true ? { confirmSourceText: true } : {}) }, request.signal);
    const excerpt = await invoke("read", input, request.signal).catch(() => { throw fail("readback_unconfirmed"); }) as Excerpt | null;
    if (!excerpt || excerpt.material_id !== input.materialId || excerpt.revision !== Number(body.expectedRevision) + 1
      || excerpt.status !== "confirmed" || excerpt.basis_hash !== body.expectedBasisHash) throw fail("readback_unconfirmed");
    const currentSource = await invoke("source_preview", input, request.signal).catch(() => { throw fail("readback_unconfirmed"); });
    if (!currentMaterialSourcePreview(currentSource, input.materialId) || currentSource.status !== "ready"
      || currentSource.basis_hash !== body.expectedBasisHash || currentSource.source_hash !== excerpt.source_hash
      || currentSource.record_hash !== excerpt.record_hash) throw fail("stale_source");
    if (currentSource.source_review_required === "image_text" && body.confirmSourceText !== true
      || !selectionReadbackMatches(currentSource, body.sourceSpans as Span[], excerpt)) throw fail("readback_unconfirmed");
    return NextResponse.json({ excerpt });
  } catch (error) { return errorResponse(error); }
}
