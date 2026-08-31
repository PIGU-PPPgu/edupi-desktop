"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { buildEduPiQuickEntryItems, type EduPiQuickEntryItem } from "@/lib/edupi-quick-entry";

const KIND_LABEL: Record<EduPiQuickEntryItem["kind"], string> = { chat: "协作", task: "任务", artifact: "产物", calendar: "日程" };

export function EduPiQuickEntry({
  open,
  education,
  onClose,
  onSelect,
}: {
  open: boolean;
  education: EducationContract;
  onClose: () => void;
  onSelect: (item: EduPiQuickEntryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const items = useMemo(() => buildEduPiQuickEntryItems(education, query), [education, query]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  useEffect(() => { if (activeIndex >= items.length) setActiveIndex(Math.max(0, items.length - 1)); }, [activeIndex, items.length]);
  if (!open) return null;

  return <div className="edupi-quick-entry-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="edupi-quick-entry" role="dialog" aria-modal="true" aria-label="快速打开" onKeyDownCapture={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? (current <= 0 ? focusable.length - 1 : current - 1)
        : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
      event.preventDefault();
      focusable[next].focus();
    }}>
      <label><span aria-hidden="true">⌕</span><input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="edupi-quick-entry-results" aria-activedescendant={items[activeIndex] ? `edupi-quick-entry-${items[activeIndex].id.replace(/[^A-Za-z0-9_-]/g, "-")}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => items.length ? (index + 1) % items.length : 0); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => items.length ? (index - 1 + items.length) % items.length : 0); }
        else if (event.key === "Enter" && items[activeIndex]) { event.preventDefault(); onSelect(items[activeIndex]); }
      }} placeholder="搜索任务、日程、产物或 Chat" aria-label="搜索 EduPi" /></label>
      <div id="edupi-quick-entry-results" className="edupi-quick-entry__results" role="listbox">
        {items.map((item, index) => <button id={`edupi-quick-entry-${item.id.replace(/[^A-Za-z0-9_-]/g, "-")}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "is-active" : ""} key={item.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => onSelect(item)}><em>{KIND_LABEL[item.kind]}</em><div><strong>{item.title}</strong><small>{item.subtitle}</small></div></button>)}
        {items.length === 0 ? <p>没有匹配结果</p> : null}
      </div>
      <footer><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></footer>
    </section>
  </div>;
}
