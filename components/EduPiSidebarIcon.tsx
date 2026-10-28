export function EduPiSidebarIcon({ expanded }: { expanded: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 4.5v15" />{expanded ? <path d="m6.8 10-2 2 2 2" /> : <path d="m12 10 2 2-2 2" />}</svg>;
}
