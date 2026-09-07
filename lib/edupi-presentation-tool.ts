import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import PptxGenJS from "../vendor/pptxgenjs/pptxgen.cjs";

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  path: Type.String({ description: "工作区内 .edupi/output/ 开头、.pptx 结尾的相对路径" }),
  slides: Type.Array(Type.Object({ title: Type.String({ maxLength: 200 }), points: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 12 }) }), { minItems: 1, maxItems: 60 }),
}, { additionalProperties: false });

export function createEduPiPresentationTool(projectRoot: string) {
  return defineTool<typeof parameters, { path: string; slideCount: number }>({
    name: "edupi_make_ppt", label: "生成课件", parameters,
    description: "把教学内容生成为真正的 PowerPoint 课件文件，不需要安装 Python。填写每页标题和要点，产物自动进入材料。",
    execute: async (_id, input: Static<typeof parameters>, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const root = path.resolve(projectRoot, ".edupi/output");
      const destination = path.resolve(projectRoot, input.path);
      const relative = path.relative(root, destination);
      if (path.resolve(ctx.cwd) !== path.resolve(projectRoot) || relative.startsWith("..") || path.isAbsolute(relative) || !destination.endsWith(".pptx")) throw new Error("课件必须保存到当前工作区的输出目录");
      const deck = new PptxGenJS();
      deck.layout = "LAYOUT_WIDE";
      deck.title = input.title; deck.author = "EduPi";
      for (const item of input.slides) {
        const slide = deck.addSlide();
        slide.addText(item.title, { x: 0.6, y: 0.45, w: 12, h: 0.8, fontSize: 28, bold: true, color: "243746" });
        slide.addText(item.points.map(text => ({ text, options: { breakLine: true, bullet: true } })), { x: 0.8, y: 1.7, w: 11.6, h: 4.8, fontSize: 20, color: "30343B", paraSpaceAfter: 14, fit: "shrink" });
      }
      await mkdir(path.dirname(destination), { recursive: true });
      signal?.throwIfAborted();
      await deck.writeFile({ fileName: destination });
      return { content: [{ type: "text", text: `课件已生成，共 ${input.slides.length} 页：${input.path}` }], details: { path: destination, slideCount: input.slides.length } };
    },
  });
}
