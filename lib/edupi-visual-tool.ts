import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import QRCode from "qrcode";
import { IMAGE_PREVIEW_MAX_BYTES } from "./file-types";

const qrParameters = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 2048, description: "二维码实际编码的内容。不能猜测登录令牌或使用尚未获得的链接。" }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
}, { additionalProperties: false });

const imageParameters = Type.Object({
  path: Type.String({ minLength: 1, description: "当前工作区输出目录中的 PNG、JPEG、WebP 或 GIF 文件" }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
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
