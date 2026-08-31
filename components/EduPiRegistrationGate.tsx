"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
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

function WelcomeWordmark({ started, onComplete }: { started: boolean; onComplete: () => void }) {
  const [coloring, setColoring] = useState(false);
  const finishWriting = (event: ReactAnimationEvent<SVGRectElement>) => {
    if (event.animationName === "edupi-handwrite") setColoring(true);
  };
  const finishColor = (event: ReactAnimationEvent<SVGGElement>) => {
    if (event.animationName === "edupi-color-settle") onComplete();
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
          <linearGradient id="edupi-welcome-ink" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2477ff" />
            <stop offset="0.34" stopColor="#8e5bff" />
            <stop offset="0.67" stopColor="#ff5f80" />
            <stop offset="1" stopColor="#ff9f2f" />
          </linearGradient>
          <clipPath id="edupi-welcome-clip-1"><rect className="edupi-welcome-brush is-1" x="70" y="20" width="130" height="132" /></clipPath>
          <clipPath id="edupi-welcome-clip-2"><rect className="edupi-welcome-brush is-2" x="186" y="20" width="130" height="132" /></clipPath>
          <clipPath id="edupi-welcome-clip-3"><rect className="edupi-welcome-brush is-3" x="302" y="20" width="130" height="132" /></clipPath>
          <clipPath id="edupi-welcome-clip-4"><rect className="edupi-welcome-brush is-4" x="418" y="20" width="130" height="132" /></clipPath>
          <clipPath id="edupi-welcome-clip-5">
            <rect
              className="edupi-welcome-brush is-5"
              x="546"
              y="20"
              width="304"
              height="132"
              onAnimationEnd={finishWriting}
            />
          </clipPath>
        </defs>
        <g
          className={`edupi-welcome-ink${coloring ? " is-coloring" : ""}`}
          onAnimationEnd={finishColor}
        >
          <text className="edupi-welcome-glyph" x="82" y="130" clipPath="url(#edupi-welcome-clip-1)">欢</text>
          <text className="edupi-welcome-glyph" x="198" y="130" clipPath="url(#edupi-welcome-clip-2)">迎</text>
          <text className="edupi-welcome-glyph" x="314" y="130" clipPath="url(#edupi-welcome-clip-3)">使</text>
          <text className="edupi-welcome-glyph" x="430" y="130" clipPath="url(#edupi-welcome-clip-4)">用</text>
          <text className="edupi-welcome-signature" x="558" y="128" clipPath="url(#edupi-welcome-clip-5)">EduPi</text>
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
