"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getComputerUseStatusNative } from "@/lib/desktop-computer-use";
import { computerUseControlSession, computerUseHostSessionKey } from "@/lib/computer-use-permissions";
import type { ComputerUseHostIdentity } from "@/lib/edupi-computer-use";

export function useDesktopHostIdentity(desktop: boolean) {
  const [identity, setIdentity] = useState<{ host: ComputerUseHostIdentity | null; loading: boolean }>({ host: null, loading: true });
  const activeRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const refresh = useCallback(async () => {
    if (!desktop || !activeRef.current) return;
    const requestId = ++requestSequenceRef.current;
    const isCurrent = () => activeRef.current && requestId === requestSequenceRef.current;
    setIdentity({ host: null, loading: true });
    try {
      const status = await getComputerUseStatusNative();
      const host = status?.host;
      if (isCurrent()) {
        computerUseControlSession.observe(status);
        setIdentity({ host: computerUseHostSessionKey(host) ? host ?? null : null, loading: false });
      }
    } catch {
      if (isCurrent()) setIdentity({ host: null, loading: false });
    }
  }, [desktop]);
  useEffect(() => {
    activeRef.current = desktop;
    void refresh();
    return () => { activeRef.current = false; };
  }, [desktop, refresh]);
  return { ...(desktop ? identity : { host: null, loading: false }), refresh };
}
