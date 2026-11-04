"use client";

import { useEffect, useRef, useState } from "react";

export interface ChatVisualItem {
  src: string;
  title: string;
  kind: "image" | "qr";
  filePath?: string;
}

function ScanDialog({ item, onClose, onOpenInPanel }: { item: ChatVisualItem; onClose: () => void; onOpenInPanel?: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useEffect(() => { setImageFailed(false); }, [item.src]);

  return <dialog ref={dialogRef} className="edupi-chat-scan-dialog" aria-modal="true" aria-label={item.title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="edupi-chat-scan-dialog__head"><strong>{item.title}</strong>{onOpenInPanel && !imageFailed ? <button type="button" onClick={() => { onOpenInPanel(); onClose(); }}>在侧栏查看</button> : null}<button ref={closeRef} type="button" onClick={onClose} aria-label="关闭扫码窗口">×</button></div>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={item.src} alt={item.title} onLoad={() => setImageFailed(false)} onError={() => setImageFailed(true)} style={imageFailed ? { display: "none" } : undefined} />
    {imageFailed ? <p role="status">二维码已失效，请重新发起扫码。</p> : null}
  </dialog>;
}

export function ChatVisualResult({ items, autoOpenQr = false, standalone = false, onOpenFile, onOpenImage }: {
  items: ChatVisualItem[];
  autoOpenQr?: boolean;
  standalone?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenImage?: (src: string) => void;
}) {
  const [scanItem, setScanItem] = useState<ChatVisualItem | null>(null);
  const autoOpened = useRef(false);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const [failedQr, setFailedQr] = useState<Record<string, boolean>>({});
  const liveQrPath = items.find(item => item.kind === "qr" && item.filePath)?.filePath ?? null;
  const [qrRefresh, setQrRefresh] = useState(0);
  useEffect(() => {
    if (!liveQrPath) return;
    const timer = window.setInterval(() => setQrRefresh(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [liveQrPath]);
  const currentSrc = (item: ChatVisualItem) => item.kind === "qr" && item.filePath
    ? `${item.src}${item.src.includes("?") ? "&" : "?"}qrRefresh=${qrRefresh}`
    : item.src;
  const closeScan = () => {
    setScanItem(null);
    requestAnimationFrame(() => qrTriggerRef.current?.focus());
  };

  useEffect(() => {
    if (!autoOpenQr || autoOpened.current) return;
    const qr = items.find(item => item.kind === "qr");
    if (!qr) return;
    autoOpened.current = true;
    setScanItem(qr);
  }, [autoOpenQr, items]);

  if (items.length === 0) return null;
  const firstQrIndex = items.findIndex(item => item.kind === "qr");
  return <div className={`edupi-chat-visual-results${standalone ? " is-standalone" : ""}`}>
    {items.map((item, index) => {
      const itemKey = item.filePath ?? String(index);
      return <button
      key={`${item.kind}:${itemKey}`}
      ref={index === firstQrIndex ? qrTriggerRef : undefined}
      type="button"
      className={`edupi-chat-visual-result${item.kind === "qr" ? " is-qr" : ""}`}
      aria-label={item.kind === "qr" ? "打开扫码窗口" : `在侧栏查看${item.title}`}
      onClick={(event) => {
        if (item.kind === "qr") { qrTriggerRef.current = event.currentTarget; setScanItem(item); }
        else if (item.filePath) onOpenFile?.(item.filePath);
        else onOpenImage?.(item.src);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={currentSrc(item)} alt="" loading="lazy" style={failedQr[itemKey] ? { opacity: 0.25 } : undefined}
        onError={item.kind === "qr" ? () => setFailedQr(current => ({ ...current, [itemKey]: true })) : undefined}
        onLoad={item.kind === "qr" ? () => setFailedQr(current => current[itemKey] ? { ...current, [itemKey]: false } : current) : undefined} />
      <span>{failedQr[itemKey] ? "二维码已失效" : item.title}</span>
    </button>;
    })}
    {scanItem ? <ScanDialog item={{ ...scanItem, src: currentSrc(scanItem) }} onClose={closeScan}
      onOpenInPanel={scanItem.filePath && onOpenFile ? () => onOpenFile(scanItem.filePath!)
        : !scanItem.filePath && onOpenImage ? () => onOpenImage(currentSrc(scanItem)) : undefined} /> : null}
  </div>;
}
