// Plain inline SVGs, not an icon-set dependency - these are the only icons
// the app needs today. Reach for a real icon set (see DESIGN.md) before a
// third one shows up.

export function ThemeIcon({ theme }: { theme: 'dark' | 'light' }) {
  if (theme === 'dark') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          d="M8 0.75v2M8 13.25v2M15.25 8h-2M2.75 8h-2M13.03 2.97l-1.41 1.41M4.38 11.62l-1.41 1.41M13.03 13.03l-1.41-1.41M4.38 4.38 2.97 2.97"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="currentColor" d="M13.5 9.7A5.75 5.75 0 0 1 6.3 2.5a5.75 5.75 0 1 0 7.2 7.2Z" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6.5a4 4 0 0 1 8 0c0 2.7.6 4 1.3 4.75.2.2.05.55-.23.55H2.93c-.28 0-.42-.35-.23-.55C3.4 10.5 4 9.2 4 6.5Z"
      />
      <path stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}
