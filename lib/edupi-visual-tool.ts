import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import QRCode from "qrcode";
import { createCanvas } from "@napi-rs/canvas";
import { IMAGE_PREVIEW_MAX_BYTES } from "./file-types";

const qrParameters = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 2048, description: "二维码实际编码的内容。不能猜测登录令牌或使用尚未获得的链接。" }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
}, { additionalProperties: false });

const imageParameters = Type.Object({
  path: Type.String({ minLength: 1, description: "当前工作区输出目录中的 PNG、JPEG、WebP 或 GIF 文件" }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
}, { additionalProperties: false });

const diagramParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 80 }),
  width: Type.Number({ minimum: 256, maximum: 1024 }),
  height: Type.Number({ minimum: 256, maximum: 768 }),
  elements: Type.Array(Type.Object({
    kind: Type.Union([Type.Literal("text"), Type.Literal("line"), Type.Literal("rect"), Type.Literal("circle")]),
    x: Type.Number({ minimum: 0, maximum: 1024 }),
    y: Type.Number({ minimum: 0, maximum: 768 }),
    x2: Type.Optional(Type.Number({ minimum: 0, maximum: 1024 })),
    y2: Type.Optional(Type.Number({ minimum: 0, maximum: 768 })),
    width: Type.Optional(Type.Number({ minimum: 1, maximum: 1024 })),
    height: Type.Optional(Type.Number({ minimum: 1, maximum: 768 })),
    radius: Type.Optional(Type.Number({ minimum: 1, maximum: 384 })),
    text: Type.Optional(Type.String({ maxLength: 120 })),
    size: Type.Optional(Type.Number({ minimum: 12, maximum: 64 })),
    color: Type.Optional(Type.String({ pattern: "^#[0-9a-fA-F]{6}$" })),
    fill: Type.Optional(Type.String({ pattern: "^#[0-9a-fA-F]{6}$" })),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 80 }),
}, { additionalProperties: false });

const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const outputDirectories = [".edupi/output", "教学产物", "deliverables", "output"];

export function createEduPiQrTool() {
  return defineTool<typeof qrParameters, { visual: { kind: "qr"; title: string } }>({
    name: "edupi_show_qr",
    label: "显示二维码",
    description: "把已知的链接或短文本生成为当前聊天里的可扫码二维码，并提供放大窗口。登录二维码必须从真实登录工具取得内容，不能猜测或替代。",
    parameters: qrParameters,
    execute: async (_id, input: Static<typeof qrParameters>, signal) => {
      signal?.throwIfAborted();
      if (Buffer.byteLength(input.text, "utf8") > 2048) throw new Error("二维码内容过长");
      const dataUrl = await QRCode.toDataURL(input.text, { errorCorrectionLevel: "M", margin: 3, width: 480 });
      signal?.throwIfAborted();
      const title = input.title?.trim() || "二维码";
      return {
        content: [
          { type: "text" as const, text: `${title}已显示在对话中。` },
          { type: "image" as const, data: dataUrl.slice("data:image/png;base64,".length), mimeType: "image/png" },
        ],
        details: { visual: { kind: "qr" as const, title } },
      };
    },
  });
}

export function createEduPiShowImageTool(projectRoot: string) {
  return defineTool<typeof imageParameters, { visual: { kind: "image"; title: string; path: string } }>({
    name: "edupi_show_image",
    label: "显示图片",
    description: "把已经生成到当前工作区输出目录的 PNG、JPEG、WebP 或 GIF 图片展示在对话中，老师可在右侧放大查看。此工具不会生成图片。",
    parameters: imageParameters,
    execute: async (_id, input: Static<typeof imageParameters>, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const root = realpathSync(projectRoot);
      if (realpathSync(ctx.cwd) !== root) throw new Error("只能展示当前教学工作区的图片");
      const requested = path.resolve(root, input.path);
      const file = realpathSync(requested);
      const allowed = outputDirectories.some(directory => {
        const parent = path.resolve(root, directory);
        return file.startsWith(`${parent}${path.sep}`);
      });
      if (!allowed || !rasterExtensions.has(path.extname(file).toLowerCase())) throw new Error("图片必须位于当前工作区的输出目录");
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > IMAGE_PREVIEW_MAX_BYTES) throw new Error("图片不可读取或超过 10 MB");
      const title = input.title?.trim() || path.basename(file);
      return {
        content: [{ type: "text" as const, text: `${title}已显示在对话中。` }],
        details: { visual: { kind: "image" as const, title, path: file } },
      };
    },
  });
}

/** A bounded local drawing path for diagrams when no paid image model is configured. */
export function createEduPiDiagramTool() {
  return defineTool<typeof diagramParameters, { visual: { kind: "image"; title: string } }>({
    name: "edupi_draw_diagram",
    label: "绘制示意图",
    description: "直接绘制并在当前对话展示教学示意图、几何图或简单关系图，不调用图片模型。坐标为像素，颜色用 #RRGGBB。复杂静态图也可在最终回复给出自包含的 ```html 或 ```mermaid 代码块，客户端会自动预览；不要声称聊天不能展示图形。真实照片或艺术图片仍需独立图片模型。",
    parameters: diagramParameters,
    execute: async (_id, input: Static<typeof diagramParameters>, signal) => {
      signal?.throwIfAborted();
      const canvas = createCanvas(input.width, input.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, input.width, input.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const item of input.elements) {
        signal?.throwIfAborted();
        if ((item.kind === "text" && !item.text)
          || (item.kind === "line" && (item.x2 === undefined || item.y2 === undefined))
          || (item.kind === "rect" && (item.width === undefined || item.height === undefined))
          || (item.kind === "circle" && item.radius === undefined)) throw new Error("示意图图元缺少必要内容");
        ctx.strokeStyle = item.color || "#263a4d";
        ctx.lineWidth = 3;
        if (item.kind === "text" && item.text) {
          ctx.fillStyle = item.color || "#263a4d";
          ctx.font = `${item.size || 24}px sans-serif`;
          ctx.textBaseline = "top";
          ctx.fillText(item.text, item.x, item.y);
        } else if (item.kind === "line" && item.x2 !== undefined && item.y2 !== undefined) {
          ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(item.x2, item.y2); ctx.stroke();
        } else if (item.kind === "rect" && item.width && item.height) {
          if (item.fill) { ctx.fillStyle = item.fill; ctx.fillRect(item.x, item.y, item.width, item.height); }
          ctx.strokeRect(item.x, item.y, item.width, item.height);
        } else if (item.kind === "circle" && item.radius) {
          ctx.beginPath(); ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
          if (item.fill) { ctx.fillStyle = item.fill; ctx.fill(); }
          ctx.stroke();
        }
      }
      const data = canvas.toBuffer("image/png").toString("base64");
      return {
        content: [{ type: "text" as const, text: `${input.title}已显示在对话中。` }, { type: "image" as const, data, mimeType: "image/png" }],
        details: { visual: { kind: "image" as const, title: input.title } },
      };
    },
  });
}
