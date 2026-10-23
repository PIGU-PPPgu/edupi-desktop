"use client";

import { useEffect, useState } from "react";
import { getComputerUseStatusNative } from "@/lib/desktop-computer-use";
import { computerUseHostSessionKey } from "@/lib/computer-use-permissions";
import type { ComputerUseHostIdentity } from "@/lib/edupi-computer-use";

export function useDesktopHostIdentity(desktop: boolean) {
  const [identity, setIdentity] = useState<{ host: ComputerUseHostIdentity | null; loading: boolean }>({ host: null, loading: true });
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getComputerUseStatusNative().then(status => {
      const host = status?.host;
      if (active) setIdentity({ host: computerUseHostSessionKey(host) ? host ?? null : null, loading: false });
    }).catch(() => {
      if (active) setIdentity({ host: null, loading: false });
    });
    return () => { active = false; };
  }, [desktop]);
  return desktop ? identity : { host: null, loading: false };
}
