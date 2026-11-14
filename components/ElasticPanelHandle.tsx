"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { PanelHandleMotion, ResizablePanel } from "@/hooks/useResizablePanel";

// Interaction reference: “Elastic Panel Resize — React”, supplied by the user.
// Source: https://x.com/alvish/status/2111084319716647114/video/1
// The attachment describes an independent reconstruction, with no top-level
// license. Its demo runtime, styling and embedded assets are not incorporated.
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function resistedPanelStretch(excess: number): number {
  return Math.sign(excess) * 15 * (1 - Math.exp(-Math.abs(excess) / 35));
}

/** Animates only the SVG. The resize hook remains the sole layout/prefs owner. */
export function createElasticPanelMotion(host: HTMLDivElement, motionRef: MutableRefObject<PanelHandleMotion>) {
  const paths = host.querySelectorAll("path");
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let hovered = false, focused = false, visible = false, disposed = false;
  let frame = 0, lastTime = 0, hideTimer: ReturnType<typeof setTimeout> | undefined;
  let bend = 0, bendVelocity = 0, offset = 0, offsetVelocity = 0;
  let reveal = 0, length = 60, thickness = 0;

  function draw() {
    const x = 40 + offset;
    const path = `M${x} ${80 - length / 2} Q${x + bend * 2} 80 ${x} ${80 + length / 2}`;
    paths.forEach(node => node.setAttribute("d", path));
    host.style.setProperty("--elastic-reveal", String(reveal));
    host.style.setProperty("--elastic-thickness", String(thickness));
    host.dataset.elasticState = motionRef.current.dragging ? "dragging" : frame ? "settling" : "idle";
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function tick(now: number) {
    frame = 0;
    if (disposed) return;
    const dt = Math.min((now - lastTime) / 1000 || 1 / 60, 1 / 30);
    lastTime = now;
    const motion = motionRef.current;
    const pull = motion.dragging ? clamp(Math.abs(motion.excess) / 80, 0, 1) : 0;
    const speed = motion.dragging && now - motion.time < 70 ? motion.speed : 0;
    const direction = clamp(speed / 700, -1, 1);
    const active = Math.max(Math.abs(direction) * (1 - pull), pull);
    const bendTarget = direction * 4.5 * (1 - pull);
    const offsetTarget = motion.dragging ? resistedPanelStretch(motion.excess) + direction * 7 * (1 - pull) : 0;
    const revealTarget = visible || motion.dragging ? 1 : 0;
    const lengthTarget = 60 + 30 * active + 15 * pull;
    const thicknessTarget = (10 - 5 * active - pull) * revealTarget;
    if (media.matches || document.hidden) {
      stop();
      bend = bendVelocity = offset = offsetVelocity = 0;
      reveal = revealTarget; length = 60; thickness = 10 * revealTarget;
      draw();
      return;
    }
    for (let i = 0; i < 4; i++) {
      const step = dt / 4;
      bendVelocity += ((bendTarget - bend) * 680 - bendVelocity * 34) * step;
      bend += bendVelocity * step;
      offsetVelocity += ((offsetTarget - offset) * 400 - offsetVelocity * 26) * step;
      offset += offsetVelocity * step;
    }
    const amount = 1 - Math.exp(-32 * dt);
    reveal += (revealTarget - reveal) * amount;
    length += (lengthTarget - length) * amount;
    thickness += (thicknessTarget - thickness) * amount;
    const moving = Math.abs(bendTarget - bend) > .01 || Math.abs(bendVelocity) > .03
      || Math.abs(offsetTarget - offset) > .01 || Math.abs(offsetVelocity) > .03
      || Math.abs(lengthTarget - length) > .01 || Math.abs(thicknessTarget - thickness) > .01
      || Math.abs(revealTarget - reveal) > .001 || Math.abs(speed) > .1;
    if (moving) frame = requestAnimationFrame(tick);
    else {
      bend = bendTarget; offset = offsetTarget; bendVelocity = offsetVelocity = 0;
      reveal = revealTarget; length = lengthTarget; thickness = thicknessTarget;
    }
    draw();
  }

  function wake() {
    if (disposed) return;
    if (media.matches || document.hidden) { stop(); tick(performance.now()); }
    else if (!frame) { lastTime = performance.now(); frame = requestAnimationFrame(tick); }
  }

  function syncVisibility() {
    clearTimeout(hideTimer);
    if (hovered || focused || motionRef.current.dragging) {
      visible = true;
      wake();
    } else if (visible) {
      hideTimer = setTimeout(() => { visible = false; wake(); }, 350);
      wake();
    }
  }

  const syncMedia = () => wake();
  media.addEventListener("change", syncMedia);
  document.addEventListener("visibilitychange", syncMedia);
  draw();
  return {
    wake: syncVisibility,
    hover(value: boolean) { hovered = value; syncVisibility(); },
    focus(value: boolean) { focused = value; syncVisibility(); },
    destroy() {
      disposed = true;
      stop();
      clearTimeout(hideTimer);
      media.removeEventListener("change", syncMedia);
      document.removeEventListener("visibilitychange", syncMedia);
    },
  };
}

export function ElasticPanelHandle({ resizer, controls, className = "", name, title }: {
  resizer: ResizablePanel;
  controls: string;
  className?: string;
  name: string;
  title?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createElasticPanelMotion> | null>(null);
  const wasResizing = useRef(false);
  const cancelResize = useRef(resizer.cancelResize);
  cancelResize.current = resizer.cancelResize;
  const { separatorProps: props, motionRef, isResizing } = resizer;
  useEffect(() => {
    if (!host.current) return;
    const instance = createElasticPanelMotion(host.current, motionRef);
    controller.current = instance;
    return () => { cancelResize.current(); instance.destroy(); controller.current = null; };
  }, [motionRef]);
  useEffect(() => {
    if (wasResizing.current !== isResizing) controller.current?.wake();
    wasResizing.current = isResizing;
  }, [isResizing]);
  return <div {...props} ref={host} aria-controls={controls}
    className={`panel-resize-handle elastic-panel-handle ${className}${isResizing ? " is-resizing" : ""}`}
    data-resize-handle={name} title={title}
    onPointerEnter={event => { if (event.pointerType !== "touch") controller.current?.hover(true); }}
    onPointerLeave={() => controller.current?.hover(false)}
    onFocus={() => controller.current?.focus(true)} onBlur={() => controller.current?.focus(false)}
    onPointerDown={event => { props.onPointerDown(event); controller.current?.wake(); }}
    onPointerMove={event => { props.onPointerMove(event); controller.current?.wake(); }}
    onPointerUp={event => { props.onPointerUp(event); controller.current?.wake(); }}
    onPointerCancel={event => { props.onPointerCancel(event); controller.current?.wake(); }}
    onLostPointerCapture={event => { props.onLostPointerCapture(event); controller.current?.wake(); }}>
    <svg viewBox="0 0 80 160" aria-hidden="true" focusable="false">
      <path className="elastic-panel-handle__outline" d="M40 50 Q40 80 40 110" />
      <path className="elastic-panel-handle__ink" d="M40 50 Q40 80 40 110" />
    </svg>
  </div>;
}
