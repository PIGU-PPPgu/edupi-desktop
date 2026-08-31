"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { fetchWithRetry } from "@/lib/fetch-timeout";

type RegistrationResponse = {
  registered?: boolean;
};

type GateState = "checking" | "unregistered" | "submitting" | "leaving" | "ready" | "error";

function registrationErrorMessage(status: number): string {
  if (status === 401) return "邀请码不正确";
  if (status === 429) return "一分钟后再试";
  return "请重试";
}

const welcomeHandwriting = [
  {
    id: "1",
    delay: 160,
    step: 105,
    paths: [
      "M88 58 Q108 54 129 55",
      "M121 57 Q108 86 88 119",
      "M103 78 Q121 103 143 122",
      "M153 43 Q149 55 140 68",
      "M141 68 Q160 61 181 66",
      "M158 70 Q151 99 137 123",
      "M158 82 Q170 107 189 124",
    ],
  },
  {
    id: "2",
    delay: 850,
    step: 112,
    paths: [
      "M229 46 Q220 57 214 70",
      "M237 47 Q252 44 265 48",
      "M250 50 L250 111",
      "M263 50 Q285 48 286 58 Q286 78 278 91",
      "M211 79 Q219 84 222 91",
      "M211 102 Q222 103 220 114 Q243 130 294 122",
    ],
  },
  {
    id: "3",
    delay: 1_530,
    step: 104,
    paths: [
      "M335 45 Q328 62 316 80",
      "M326 72 L326 128",
      "M347 51 L405 51",
      "M375 44 L375 106",
      "M345 69 L401 69 L398 92 L345 92",
      "M374 94 Q360 119 340 127",
      "M373 98 Q389 119 409 127",
    ],
  },
  {
    id: "4",
    delay: 2_180,
    step: 108,
    paths: [
      "M452 48 Q451 87 445 128",
      "M452 49 L517 49 L517 126",
      "M452 75 L516 75",
      "M451 100 L516 100",
      "M484 52 L484 120",
      "M447 127 Q479 130 516 127",
    ],
  },
] as const;

function HandwritingMask({ id, delay, step, paths }: (typeof welcomeHandwriting)[number]) {
  return (
    <mask id={`edupi-welcome-mask-${id}`} maskUnits="userSpaceOnUse" x={Number(id) * 116 - 58} y="6" width="160" height="164">
      {paths.map((path, index) => (
        <path
          key={path}
          className="edupi-welcome-handwriting-stroke"
          d={path}
          pathLength="1"
          style={{ "--stroke-delay": `${delay + (index * step)}ms` } as CSSProperties}
        />
      ))}
    </mask>
  );
}

function WelcomeTextLayer({ className, surface = false }: { className: string; surface?: boolean }) {
  return (
    <g className={className} filter={surface ? "url(#edupi-welcome-glass-surface)" : undefined}>
      <text className="edupi-welcome-glyph" x="82" y="130" mask="url(#edupi-welcome-mask-1)">欢</text>
      <text className="edupi-welcome-glyph" x="198" y="130" mask="url(#edupi-welcome-mask-2)">迎</text>
      <text className="edupi-welcome-glyph" x="314" y="130" mask="url(#edupi-welcome-mask-3)">使</text>
      <text className="edupi-welcome-glyph" x="430" y="130" mask="url(#edupi-welcome-mask-4)">用</text>
      <text className="edupi-welcome-signature" x="558" y="128" mask="url(#edupi-welcome-mask-5)">EduPi</text>
    </g>
  );
}

function WelcomeWordmark({ started, onComplete }: { started: boolean; onComplete: () => void }) {
  const [coloring, setColoring] = useState(false);
  const finishWriting = (event: ReactAnimationEvent<SVGRectElement>) => {
    if (event.animationName === "edupi-handwrite") setColoring(true);
  };
  const finishColor = (event: ReactAnimationEvent<SVGGElement>) => {
    if (event.animationName === "edupi-glass-settle") onComplete();
  };

  return (
    <div className="edupi-welcome-mark">
      <h1 className="edupi-welcome-sr-only">欢迎使用 EduPi</h1>
      <svg
        className={`edupi-welcome-wordmark${started ? " is-writing" : ""}`}
        viewBox="0 0 920 180"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="edupi-welcome-glass-fill" gradientUnits="userSpaceOnUse" x1="64" y1="20" x2="858" y2="156">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.94" />
            <stop offset="0.18" stopColor="#75ddff" stopOpacity="0.56" />
            <stop offset="0.4" stopColor="#9d8cff" stopOpacity="0.5" />
            <stop offset="0.64" stopColor="#ff8fc8" stopOpacity="0.58" />
            <stop offset="0.82" stopColor="#ffc86f" stopOpacity="0.48" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="edupi-welcome-glass-edge" gradientUnits="userSpaceOnUse" x1="80" y1="18" x2="844" y2="150">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.98" />
            <stop offset="0.3" stopColor="#b5efff" stopOpacity="0.78" />
            <stop offset="0.58" stopColor="#d3b9ff" stopOpacity="0.72" />
            <stop offset="0.8" stopColor="#ffd2e3" stopOpacity="0.78" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.96" />
          </linearGradient>
          <linearGradient id="edupi-welcome-glass-highlight" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="0.24" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="0.52" stopColor="#c7f4ff" stopOpacity="0.46" />
            <stop offset="0.72" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.72" />
          </linearGradient>
          <filter id="edupi-welcome-glass-surface" x="-24%" y="-45%" width="148%" height="205%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="13" result="soft-shadow" />
            <feOffset in="soft-shadow" dy="18" result="shadow-offset" />
            <feFlood floodColor="#5062d8" floodOpacity="0.24" result="shadow-color" />
            <feComposite in="shadow-color" in2="shadow-offset" operator="in" result="shadow" />
            <feGaussianBlur in="SourceAlpha" stdDeviation="2.1" result="surface" />
            <feSpecularLighting in="surface" surfaceScale="7" specularConstant="0.86" specularExponent="28" lightingColor="#ffffff" result="specular">
              <fePointLight x="250" y="-90" z="300" />
            </feSpecularLighting>
            <feComposite in="specular" in2="SourceAlpha" operator="in" result="lit" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="lit" />
            </feMerge>
          </filter>
          <filter id="edupi-welcome-brush-soft" x="-12%" y="-18%" width="124%" height="136%">
            <feGaussianBlur stdDeviation="3.8" />
          </filter>
          {welcomeHandwriting.map((mask) => <HandwritingMask key={mask.id} {...mask} />)}
          <mask id="edupi-welcome-mask-5" maskUnits="userSpaceOnUse" x="534" y="8" width="328" height="158">
            <rect
              className="edupi-welcome-brush is-5"
              x="542"
              y="16"
              width="312"
              height="142"
              rx="28"
              onAnimationEnd={finishWriting}
            />
          </mask>
        </defs>
        <g
          className={`edupi-welcome-glass${coloring ? " is-coloring" : ""}`}
          onAnimationEnd={finishColor}
        >
          <WelcomeTextLayer className="edupi-welcome-glow" />
          <WelcomeTextLayer className="edupi-welcome-glass-body" surface />
          <WelcomeTextLayer className="edupi-welcome-glass-highlight" />
          <circle className="edupi-welcome-writing-light" cx="72" cy="88" r="7" />
        </g>
      </svg>
    </div>
  );
}

export function EduPiRegistrationGate({
  children,
  initialRegistered,
}: {
  children: ReactNode;
  initialRegistered: boolean | null;
}) {
  const [state, setState] = useState<GateState>(() => (
    initialRegistered === true ? "ready" : initialRegistered === false ? "unregistered" : "error"
  ));
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState<string | null>(() => (
    initialRegistered === null ? "连接失败" : null
  ));
  const [sequenceStarted, setSequenceStarted] = useState(false);
  const [revealAccess, setRevealAccess] = useState(initialRegistered === true);
  const mountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const sequenceFrameRef = useRef<number | null>(null);
  const revealFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealWelcomeAccess = useCallback(() => {
    if (revealFallbackRef.current) clearTimeout(revealFallbackRef.current);
    revealFallbackRef.current = null;
    if (mountedRef.current) setRevealAccess(true);
  }, []);

  const checkRegistration = useCallback(async () => {
    setState("checking");
    setMessage(null);
    try {
      const response = await fetchWithRetry("/api/edupi/registration", {
        shouldRetry: () => mountedRef.current,
      });
      const body = await response.json() as RegistrationResponse;
      if (!response.ok) throw new Error("registration unavailable");
      if (!mountedRef.current) return;
      setState(body.registered ? "ready" : "unregistered");
    } catch {
      if (!mountedRef.current) return;
      setMessage("连接失败");
      setState("error");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotion = (event: MediaQueryListEvent) => {
      if (event.matches) revealWelcomeAccess();
    };

    if (initialRegistered !== true) {
      if (motion.matches) revealWelcomeAccess();
      else {
        sequenceFrameRef.current = requestAnimationFrame(() => {
          sequenceFrameRef.current = null;
          if (!mountedRef.current) return;
          setSequenceStarted(true);
          revealFallbackRef.current = setTimeout(revealWelcomeAccess, 6_500);
        });
      }
      motion.addEventListener("change", handleMotion);
    }

    return () => {
      mountedRef.current = false;
      if (sequenceFrameRef.current) cancelAnimationFrame(sequenceFrameRef.current);
      if (revealFallbackRef.current) clearTimeout(revealFallbackRef.current);
      if (transitionRef.current) clearTimeout(transitionRef.current);
      motion.removeEventListener("change", handleMotion);
    };
  }, [initialRegistered, revealWelcomeAccess]);

  useEffect(() => {
    if (!revealAccess) return;
    if (state === "error") retryRef.current?.focus();
    else if (state === "unregistered" && message) inputRef.current?.focus();
  }, [message, revealAccess, state]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === "submitting" || !inviteCode.trim()) return;
    setState("submitting");
    setMessage(null);
    try {
      const response = await fetchWithRetry("/api/edupi/registration", {
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteCode }),
        },
        shouldRetry: () => mountedRef.current,
      });
      const body = await response.json() as RegistrationResponse;
      if (!response.ok || !body.registered) {
        setMessage(registrationErrorMessage(response.status));
        setState("unregistered");
        return;
      }
      setState("leaving");
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setState("ready");
        return;
      }
      transitionRef.current = setTimeout(() => {
        if (mountedRef.current) setState("ready");
      }, 420);
    } catch {
      if (!mountedRef.current) return;
      setMessage("连接失败");
      setState("unregistered");
    }
  };

  if (state === "ready") return <>{children}</>;

  const busy = state === "checking" || state === "submitting" || state === "leaving";
  return (
    <main className={`edupi-welcome${state === "leaving" ? " is-leaving" : ""}`} aria-busy={busy}>
      <div className="edupi-welcome-stage">
        <WelcomeWordmark started={sequenceStarted} onComplete={revealWelcomeAccess} />
        <div className={`edupi-welcome-access${revealAccess ? " is-visible" : ""}`}>
          {revealAccess ? state === "checking" ? (
            <p className="edupi-welcome-status" role="status">连接中…</p>
          ) : state === "error" ? (
            <div className="edupi-welcome-retry">
              <p role="alert">{message}</p>
              <button ref={retryRef} type="button" onClick={() => void checkRegistration()}>重试</button>
            </div>
          ) : (
            <form className="edupi-welcome-form" onSubmit={submit} aria-label="注册 EduPi">
              <div className="edupi-welcome-controls">
                <label className="edupi-welcome-sr-only" htmlFor="edupi-invite-code">邀请码</label>
                <input
                  ref={inputRef}
                  id="edupi-invite-code"
                  name="inviteCode"
                  type="password"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  enterKeyHint="go"
                  autoFocus
                  required
                  maxLength={128}
                  value={inviteCode}
                  disabled={state === "submitting" || state === "leaving"}
                  aria-describedby={message ? "edupi-registration-error" : undefined}
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="邀请码"
                />
                <button type="submit" disabled={busy || !inviteCode.trim()}>
                  {state === "submitting" ? "进入中…" : state === "leaving" ? "欢迎" : "继续"}
                </button>
              </div>
              {message ? <p id="edupi-registration-error" className="edupi-welcome-error" role="alert">{message}</p> : null}
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
