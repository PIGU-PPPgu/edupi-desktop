import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { getBase64DecodedByteLength } from "@/lib/image-attachments";
import { IMAGE_PREVIEW_MAX_BYTES } from "@/lib/file-types";

type ImageBlock = { type: "image"; data?: string; mimeType?: string; source?: { type?: string; data?: string; media_type?: string } };

function hasImageSignature(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/gif") return bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mime === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const rawIndex = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = rawIndex === null ? Number.NaN : Number(rawIndex);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) return NextResponse.json({ error: "Valid blockIndex is required" }, { status: 400 });
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const entry = getSessionEntries(filePath).find(candidate => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "toolResult") return NextResponse.json({ error: "Tool image not found" }, { status: 404 });
    const block = entry.message.content[blockIndex] as ImageBlock | undefined;
    if (!block || block.type !== "image") return NextResponse.json({ error: "Tool image not found" }, { status: 404 });
    const data = typeof block.data === "string" ? block.data : block.source?.type === "base64" ? block.source.data : undefined;
    const mime = typeof block.mimeType === "string" ? block.mimeType : block.source?.media_type;
    if (!data || !mime) return NextResponse.json({ error: "Tool image not found" }, { status: 404 });
    const size = getBase64DecodedByteLength(data);
    if (size === null) return NextResponse.json({ error: "Invalid image data" }, { status: 400 });
    if (size > IMAGE_PREVIEW_MAX_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 413 });
    const bytes = Buffer.from(data, "base64");
    if (!hasImageSignature(bytes, mime)) return NextResponse.json({ error: "Unsupported image" }, { status: 415 });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Tool image unavailable" }, { status: 500 });
  }
}
