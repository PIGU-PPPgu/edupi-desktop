/** Only image payloads or the narrowly scoped session-image endpoint may open in chat. */
export function isPreviewableImageSource(src: string): boolean {
  return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src)
    || /^https?:\/\/\S+$/i.test(src)
    || /^\/api\/sessions\/[a-z0-9-]+\/entries\/[a-z0-9-]+\/image\?blockIndex=\d+$/i.test(src);
}
