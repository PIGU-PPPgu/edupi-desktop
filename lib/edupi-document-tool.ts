import { lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  path: Type.String({ minLength: 1, maxLength: 500, description: "工作区内 .edupi/output/ 开头、.docx 结尾的相对路径" }),
  sections: Type.Array(Type.Object({
    heading: Type.Optional(Type.String({ maxLength: 200 })),
    paragraphs: Type.Array(Type.String({ minLength: 1, maxLength: 10000 }), { minItems: 1, maxItems: 100 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
}, { additionalProperties: false });

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function validText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.trim().length > 0) && value.length <= maxLength
    && !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value);
}

function paragraph(text: string, style: string) {
  const runs = text.split(/\r\n|\r|\n/).map(line => `<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join("<w:r><w:br/></w:r>");
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs}</w:p>`;
}

// Check every directory before creating its child, so even .edupi cannot redirect writes.
function outputDirectory(root: string, destination: string) {
  let directory = root;
  for (const segment of path.relative(root, path.dirname(destination)).split(path.sep)) {
    directory = path.join(directory, segment);
    try { mkdirSync(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("文档输出目录不能使用符号链接");
  }
}

export function createEduPiDocumentTool(projectRoot: string) {
  return defineTool<typeof parameters, { path: string; paragraphCount: number }>({
    name: "edupi_make_document", label: "生成文档", parameters,
    description: "将标题、章节和正文生成为 Word 文档，无需 Python 或 Office。保存到 .edupi/output/，产物自动进入材料。正文总长度最多 200000 字符。",
    execute: async (_id, input: Static<typeof parameters>, signal, _update, ctx) => {
      signal?.throwIfAborted();
      if (!validText(input.title, 200) || !Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 100) throw new Error("文档标题或章节无效");
      let paragraphCount = 0;
      let characterCount = input.title.length;
      for (const section of input.sections) {
        if (!section || (section.heading !== undefined && !validText(section.heading, 200, true)) || !Array.isArray(section.paragraphs) || section.paragraphs.length < 1 || section.paragraphs.length > 100) throw new Error("文档章节无效");
        characterCount += section.heading?.length ?? 0;
        for (const text of section.paragraphs) {
          if (!validText(text, 10000)) throw new Error("文档段落无效");
          characterCount += text.length;
          paragraphCount++;
        }
      }
      if (characterCount > 200000 || paragraphCount > 1000) throw new Error("文档内容超过限制");
      const root = realpathSync(projectRoot);
      if (realpathSync(ctx.cwd) !== root || typeof input.path !== "string" || input.path.length > 500 || path.isAbsolute(input.path) || input.path.includes("\\") || input.path.split("/").includes("..") || !input.path.startsWith(".edupi/output/") || !input.path.endsWith(".docx")) throw new Error("文档必须保存到当前工作区的输出目录");
      const destination = path.resolve(root, input.path);
      const zip = new JSZip();
      zip.file("[Content_Types].xml", `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
      zip.file("_rels/.rels", `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
      zip.file("word/_rels/document.xml.rels", `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      zip.file("word/styles.xml", `${xmlHeader}<w:styles xmlns:w="${wordNamespace}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="320"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`);
      const body = [paragraph(input.title, "Title"), ...input.sections.flatMap(section => [
        ...(section.heading ? [paragraph(section.heading, "Heading1")] : []),
        ...section.paragraphs.map(text => paragraph(text, "Normal")),
      ])].join("");
      zip.file("word/document.xml", `${xmlHeader}<w:document xmlns:w="${wordNamespace}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
      const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      signal?.throwIfAborted();
      outputDirectory(root, destination);
      try {
        const stat = lstatSync(destination);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("文档目标必须是普通文件");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = path.join(path.dirname(destination), `.document-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, buffer, { flag: "wx", mode: 0o600 });
        signal?.throwIfAborted();
        renameSync(temporary, destination);
      } finally {
        try { unlinkSync(temporary); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return { content: [{ type: "text", text: `文档已生成，共 ${paragraphCount} 段：${input.path}` }], details: { path: destination, paragraphCount } };
    },
  });
}
