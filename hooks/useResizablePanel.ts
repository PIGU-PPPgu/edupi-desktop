"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from "react";
import { clampPanelWidth } from "@/lib/panel-layout";

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
  target: HTMLDivElement;
  previousCursor: string;
  previousUserSelect: string;
  lastX: number;
  lastTime: number;
}

/** Physical pointer motion only; never used as a panel's layout width. */
export interface PanelHandleMotion {
  dragging: boolean;
  speed: number;
  excess: number;
  time: number;
}

interface UseResizablePanelOptions {
  ariaLabel: string;
  cssVariable: `--${string}`;
  defaultWidth: number;
  getDefaultWidth?: () => number;
  getMaxWidth: () => number;
  growthDirection: "left" | "right";
  maxWidth: number;
  minWidth: number;
  storageKey: string;
  widthRef: MutableRefObject<number>;
}

interface CommitOptions {
  forcePersist?: boolean;
  persist?: boolean;
}

function readStoredWidth(storageKey: string): number | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    // Resizing remains available when storage is unavailable.
  }
}

export function useResizablePanel(options: UseResizablePanelOptions) {
  const {
    ariaLabel,
    cssVariable,
    defaultWidth,
    getDefaultWidth,
    getMaxWidth,
    growthDirection,
    maxWidth,
    minWidth,
    storageKey,
    widthRef,
  } = options;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const motionRef = useRef<PanelHandleMotion>({ dragging: false, speed: 0, excess: 0, time: 0 });
  const restoredRef = useRef(false);
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);

  const effectiveMaxWidth = useCallback(
    () => Math.min(maxWidth, Math.max(minWidth, getMaxWidth())),
    [getMaxWidth, maxWidth, minWidth],
  );

  const clampWidth = useCallback(
    (candidate: number) => clampPanelWidth(candidate, minWidth, effectiveMaxWidth()),
    [effectiveMaxWidth, minWidth],
  );

  const applyLiveWidth = useCallback((nextWidth: number) => {
    widthRef.current = nextWidth;
    panelRef.current?.style.setProperty(cssVariable, `${nextWidth}px`);
  }, [cssVariable, widthRef]);

  const commitWidth = useCallback((candidate: number, commitOptions: CommitOptions = {}) => {
    const { forcePersist = false, persist = true } = commitOptions;
    const nextWidth = clampWidth(candidate);
    const changed = nextWidth !== widthRef.current;
    applyLiveWidth(nextWidth);
    setWidth(nextWidth);
    if (persist && (changed || forcePersist)) writeStoredWidth(storageKey, nextWidth);
    return nextWidth;
  }, [applyLiveWidth, clampWidth, storageKey, widthRef]);
  const latestWidth = useRef({ applyLiveWidth, clampWidth });
  latestWidth.current = { applyLiveWidth, clampWidth };

  const restoreBodyState = useCallback((drag: DragState) => {
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
  }, []);

  const releaseCapture = useCallback((drag: DragState) => {
    try {
      if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
    } catch {
      // The UA can release capture before delivering cancellation.
    }
  }, []);

  const finishResize = useCallback((pointerId: number, cancel = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    // Clear ownership before releasing capture: the resulting lost event is a no-op.
    dragRef.current = null;
    motionRef.current = { dragging: false, speed: 0, excess: 0, time: performance.now() };
    restoreBodyState(drag);
    setIsResizing(false);
    const nextWidth = commitWidth(cancel ? drag.startWidth : widthRef.current, {
      forcePersist: !cancel,
      persist: !cancel,
    });
    drag.target.setAttribute("aria-valuenow", String(nextWidth));
    drag.target.setAttribute("aria-valuetext", `${nextWidth} px`);
    releaseCapture(drag);
  }, [commitWidth, releaseCapture, restoreBodyState, widthRef]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const now = performance.now();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      target,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
      lastX: event.clientX,
      lastTime: now,
    };
    motionRef.current = { dragging: true, speed: 0, excess: 0, time: now };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsResizing(true);
  }, [widthRef]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishResize(event.pointerId);
      return;
    }
    event.preventDefault();

    const direction = growthDirection === "right" ? 1 : -1;
    const rawWidth = drag.startWidth + ((event.clientX - drag.startX) * direction);
    const nextWidth = clampWidth(rawWidth);
    const now = performance.now();
    motionRef.current = {
      dragging: true,
      speed: Math.max(-2200, Math.min(2200, (event.clientX - drag.lastX) / Math.max((now - drag.lastTime) / 1000, .008))),
      excess: (rawWidth - nextWidth) * direction,
      time: now,
    };
    drag.lastX = event.clientX;
    drag.lastTime = now;
    applyLiveWidth(nextWidth);
    event.currentTarget.setAttribute("aria-valuenow", String(nextWidth));
    event.currentTarget.setAttribute("aria-valuetext", `${nextWidth} px`);
  }, [applyLiveWidth, clampWidth, finishResize, growthDirection]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId);
  }, [finishResize]);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishResize(event.pointerId, true);
  }, [finishResize]);

  const onLostPointerCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    // Unexpected capture loss cancels. Normal up/cancel already cleared the drag.
    finishResize(event.pointerId, true);
  }, [finishResize]);
  const cancelResize = useCallback(() => {
    const drag = dragRef.current;
    if (drag) finishResize(drag.pointerId, true);
  }, [finishResize]);

  const resetWidth = useCallback(() => {
    const nextDefault = getDefaultWidth?.() ?? defaultWidth;
    commitWidth(nextDefault, { forcePersist: true });
  }, [commitWidth, defaultWidth, getDefaultWidth]);

  const reclampWidth = useCallback(() => {
    const drag = dragRef.current;
    if (drag) {
      if (clampWidth(widthRef.current) !== widthRef.current) finishResize(drag.pointerId, true);
    } else commitWidth(widthRef.current);
  }, [clampWidth, commitWidth, finishResize, widthRef]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishResize(dragRef.current.pointerId, true);
      }
      return;
    }
    const step = event.shiftKey ? 32 : 12;
    const growKey = growthDirection === "right" ? "ArrowRight" : "ArrowLeft";
    const shrinkKey = growthDirection === "right" ? "ArrowLeft" : "ArrowRight";

    if (event.key === growKey) {
      event.preventDefault();
      commitWidth(widthRef.current + step, { forcePersist: true });
    } else if (event.key === shrinkKey) {
      event.preventDefault();
      commitWidth(widthRef.current - step, { forcePersist: true });
    } else if (event.key === "Home") {
      event.preventDefault();
      commitWidth(minWidth, { forcePersist: true });
    } else if (event.key === "End") {
      event.preventDefault();
      commitWidth(effectiveMaxWidth(), { forcePersist: true });
    } else if (event.key === "Enter") {
      event.preventDefault();
      resetWidth();
    }
  }, [commitWidth, effectiveMaxWidth, finishResize, growthDirection, minWidth, resetWidth, widthRef]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const storedWidth = readStoredWidth(storageKey);
    const candidate = storedWidth ?? getDefaultWidth?.() ?? defaultWidth;
    const restoredWidth = commitWidth(candidate, { persist: false });
    if (storedWidth !== null && storedWidth !== restoredWidth) {
      writeStoredWidth(storageKey, restoredWidth);
    }
  }, [commitWidth, defaultWidth, getDefaultWidth, storageKey]);

  useEffect(() => {
    if (!restoredRef.current) return;
    reclampWidth();

    const onResize = () => {
      const drag = dragRef.current;
      if (drag) finishResize(drag.pointerId, true);
      else commitWidth(widthRef.current);
    };
    window.addEventListener("resize", onResize);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      // The observed host can also be the legacy panel itself. Do not cancel
      // its own pointer-driven size changes.
      const nextWidth = clampWidth(widthRef.current);
      if (nextWidth !== widthRef.current) {
        const drag = dragRef.current;
        if (drag) finishResize(drag.pointerId, true);
        else commitWidth(nextWidth);
      }
    });
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [clampWidth, commitWidth, finishResize, reclampWidth, widthRef]);

  useEffect(() => {
    if (!isResizing) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelResize();
    };
    window.addEventListener("blur", cancelResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelResize, isResizing]);

  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      motionRef.current = { dragging: false, speed: 0, excess: 0, time: 0 };
      latestWidth.current.applyLiveWidth(latestWidth.current.clampWidth(drag.startWidth));
      restoreBodyState(drag);
      releaseCapture(drag);
    };
  }, [releaseCapture, restoreBodyState]);

  return {
    cancelResize,
    isResizing,
    motionRef,
    panelRef,
    reclampWidth,
    resetWidth,
    separatorProps: {
      "aria-label": ariaLabel,
      "aria-orientation": "vertical" as const,
      "aria-valuemax": effectiveMaxWidth(),
      "aria-valuemin": minWidth,
      "aria-valuenow": width,
      "aria-valuetext": `${width} px`,
      onDoubleClick: resetWidth,
      onKeyDown,
      onLostPointerCapture,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      role: "separator" as const,
      tabIndex: 0,
    },
    width,
  };
}

export type ResizablePanel = ReturnType<typeof useResizablePanel>;
