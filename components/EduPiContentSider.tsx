/**
 * @license
 * Copyright 2025-2026 NomiFun (nomifun.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted from NomiFun's ContentSider for EduPi's Next.js/Tauri workbench.
 * Original: https://github.com/nomifun/nomifun-desktop
 * Reviewed revision: 2d31bcb7dcbde1da50259cab90fe4efac11faa56
 * Modified for EduPi: removed Arco/Tailwind dependencies and reduced the API
 * to accessible header/body/footer regions styled by EduPi tokens.
 */
"use client";

import type { ReactNode } from "react";

type Props = {
  width?: number;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  className?: string;
};

export function EduPiContentSider({ width = 248, header, children, footer, ariaLabel, className = "" }: Props) {
  return (
    <aside
      aria-label={ariaLabel}
      className={`edupi-content-sider ${className}`}
      style={{ width }}
    >
      {header ? <div className="edupi-content-sider__header">{header}</div> : null}
      <div className="edupi-content-sider__scroll">{children}</div>
      {footer ? <div className="edupi-content-sider__footer">{footer}</div> : null}
    </aside>
  );
}
