/**
 * @license
 * Copyright 2025-2026 NomiFun (nomifun.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted from NomiFun's useContentSiderCollapse at revision
 * 2d31bcb7dcbde1da50259cab90fe4efac11faa56.
 * Modified to use EduPi's centralized app-pref key instead of accepting an
 * arbitrary localStorage key.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { APP_PREF_KEYS, getPrefBool, setPrefBool, type AppPrefKey } from "@/lib/app-prefs";

export function useEduPiContentSiderCollapse(defaultCollapsed = false, key: AppPrefKey = APP_PREF_KEYS.edupiObjectSiderCollapsed) {
  const [collapsed, setCollapsedState] = useState(() => getPrefBool(key, defaultCollapsed));

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    setPrefBool(key, value);
  }, [key]);

  const toggle = useCallback(() => {
    setCollapsedState((current) => {
      const next = !current;
      setPrefBool(key, next);
      return next;
    });
  }, [key]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setCollapsedState(event.newValue === "true");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  return { collapsed, setCollapsed, toggle };
}
