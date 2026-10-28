export function EduPiSurfaceIcon({ kind }: { kind: "brief" | "calendar" }) {
  return <span className={`edupi-surface-icon is-${kind}`} aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {kind === "brief" ? <>
        <path className="edupi-surface-icon__sheet" d="m8 7 15-2 3 21-15 2z" />
        <rect className="edupi-surface-icon__paper" x="6" y="7" width="18" height="21" rx="3" />
        <path d="M11 13h8M11 17h8M11 21h4" />
      </> : <>
        <rect className="edupi-surface-icon__paper" x="5" y="7" width="22" height="21" rx="4" />
        <path d="M10 4v6M22 4v6M5 14h22M11 19h3M19 19h2M11 23h3" />
      </>}
    </svg>
  </span>;
}
