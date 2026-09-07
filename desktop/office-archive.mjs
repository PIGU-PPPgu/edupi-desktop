const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_CENTRAL_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_ENTRY_BYTES = 25 * 1024 * 1024;
const archiveError = (code, message) => Object.assign(new Error(message), { code });

export function validateOfficeArchive(bytes) {
  const minimumEnd = 22;
  const searchStart = Math.max(0, bytes.length - (65_535 + minimumEnd));
  let endOffset = -1;
  for (let offset = bytes.length - minimumEnd; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw archiveError("extract_unavailable", "Office 压缩目录无效。");
  const disk = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(endOffset + 8);
  const entries = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries || entries === 0 || entries === 0xffff
    || entries > MAX_DOCX_ENTRIES || centralSize === 0xffffffff || centralSize > MAX_DOCX_CENTRAL_BYTES
    || centralOffset + centralSize > endOffset) {
    throw archiveError("extract_unavailable", "Office 压缩目录无效。");
  }
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > centralOffset + centralSize || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw archiveError("extract_unavailable", "Office 压缩目录无效。");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    if ((flags & 1) !== 0 || uncompressedSize === 0xffffffff || uncompressedSize > MAX_DOCX_ENTRY_BYTES) {
      throw archiveError("too_large", "Office 解压规模超过限制。");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw archiveError("too_large", "Office 解压规模超过限制。");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw archiveError("extract_unavailable", "Office 压缩目录无效。");
}
