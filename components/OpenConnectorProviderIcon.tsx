"use client";

/* eslint-disable @next/next/no-img-element -- Brand assets use fixed official URLs and a client-side error fallback. */

import { useState } from "react";
import { connectorIconUrl, connectorInitials } from "@/lib/openconnector-discovery";

export function OpenConnectorProviderIcon({ service, displayName, large = false }: {
  service: string; displayName: string; large?: boolean;
}) {
  const url = connectorIconUrl(service);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className={`openconnector-provider-icon${large ? " is-large" : ""}`} aria-hidden="true">
    {url && failedUrl !== url ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      : connectorInitials(displayName)}
  </span>;
}
