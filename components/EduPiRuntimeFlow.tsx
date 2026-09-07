"use client";
import React from "react";
export function EduPiRuntimeFlow({ running, toolRunning, compacting }: { running: boolean; toolRunning: boolean; compacting: boolean }) {
  if (!running && !toolRunning && !compacting) return null;
  const label = compacting ? "整理上下文" : toolRunning ? "执行工具" : "处理中";
  return <div className="edupi-runtime-flow" role="status"><svg viewBox="0 0 72 16" aria-hidden="true"><circle cx="4" cy="8" r="3" fill="currentColor"/><path d="M10 8H62" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="68" cy="8" r="3" fill="currentColor"/></svg><span>{label}</span></div>;
}
