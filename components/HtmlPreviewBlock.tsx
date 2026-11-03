"use client";

import { useEffect, useRef, useState } from "react";
import { CodeBlock } from "./MermaidBlock";

const MAX_HTML_PREVIEW_CHARS = 30_000;

export function sandboxedHtml(code: string): string {
  const policy = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;min-height:100%;background:#fff}</style></head><body>${code}</body></html>`;
}

function HtmlZoomDialog({ srcDoc, onClose }: { srcDoc: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={dialogRef} className="edupi-html-zoom-dialog" aria-modal="true" aria-label="HTML 预览" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="edupi-chat-scan-dialog__head"><strong>HTML 预览</strong><button ref={closeRef} type="button" onClick={onClose} aria-label="关闭 HTML 预览">×</button></div>
    <iframe title="放大的 HTML 预览" srcDoc={srcDoc} sandbox="" referrerPolicy="no-referrer" tabIndex={0} />
  </dialog>;
}

export function HtmlPreviewBlock({ code, isStreaming, onOpenInPanel }: { code: string; isStreaming?: boolean; onOpenInPanel?: () => void }) {
  const [preview, setPreview] = useState(!isStreaming);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [safeHtml, setSafeHtml] = useState<{ code: string; html: string } | null>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);
  const available = code.length <= MAX_HTML_PREVIEW_CHARS;
  const srcDoc = safeHtml?.code === code ? sandboxedHtml(safeHtml.html) : null;

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void import("dompurify").then(({ default: DOMPurify }) => {
      const purifier = DOMPurify(window);
      // A global ALLOWED_URI_REGEXP also strips SVG geometry such as width and x.
      purifier.addHook("uponSanitizeAttribute", (_node, data) => {
        if (["src", "href", "xlink:href"].includes(data.attrName.toLowerCase())
          && !/^(?:#|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(data.attrValue)) {
          data.keepAttr = false;
        }
      });
      const html = purifier.sanitize(code, {
        USE_PROFILES: { html: true, svg: true },
        FORBID_TAGS: ["script", "iframe", "frame", "object", "embed", "form", "meta", "link", "base"],
        FORBID_ATTR: ["srcset"],
        SANITIZE_NAMED_PROPS: true,
      });
      if (!cancelled) setSafeHtml({ code, html });
    }).catch(() => { if (!cancelled) setSafeHtml(null); });
    return () => { cancelled = true; };
  }, [code, available]);

  useEffect(() => { if (!isStreaming && available) setPreview(true); }, [isStreaming, available]);

  const openPreview = <button type="button" className="markdown-code-action" disabled={isStreaming || !available || srcDoc === null} onClick={() => setPreview(true)}>预览</button>;
  const panelButton = onOpenInPanel ? <button type="button" className="markdown-code-action" disabled={isStreaming || !available || srcDoc === null} onClick={onOpenInPanel}>在侧栏打开</button> : null;
  if (!preview || isStreaming || !available || srcDoc === null) return <CodeBlock code={code} lang="html" headerAction={<>{openPreview}{panelButton}</>} />;
  return <div className="markdown-code-block edupi-html-preview">
    <div className="markdown-code-header"><span className="markdown-code-lang">HTML</span><div className="edupi-html-preview__actions"><button type="button" className="markdown-code-action" onClick={() => setPreview(false)}>源码</button>{panelButton}<button ref={zoomTriggerRef} type="button" className="markdown-code-action" onClick={() => setZoomOpen(true)}>放大</button></div></div>
    <iframe title="HTML 预览" srcDoc={srcDoc} sandbox="" referrerPolicy="no-referrer" tabIndex={0} />
    {zoomOpen ? <HtmlZoomDialog srcDoc={srcDoc} onClose={() => { setZoomOpen(false); requestAnimationFrame(() => zoomTriggerRef.current?.focus()); }} /> : null}
  </div>;
}
