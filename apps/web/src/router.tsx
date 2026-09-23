import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

// A deliberately tiny router: five screens, path-based (not hash-based) because
// Supabase's OAuth redirect delivers the session in the URL hash.

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return path;
}

// match('/market/:id', '/market/12') -> { id: '12' }, or null if it does not fit.
export function match(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (want.length !== have.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      try {
        params[want[i].slice(1)] = decodeURIComponent(have[i]);
      } catch {
        return null;
      }
    } else if (want[i] !== have[i]) {
      return null;
    }
  }
  return params;
}

// Route params arrive as strings; ids are positive integers.
export function toId(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function Link({
  to,
  onClick,
  ...rest
}: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        onClick?.(e);
        // Leave new-tab / new-window clicks to the browser.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}

// Signing in leaves the app for Google and comes back to the site root, so a
// deep link (say, from a notification) would be lost. Remember it across the trip.
const RETURN_KEY = 'ppm.returnTo';

export function rememberReturnTo(): void {
  try {
    const here = window.location.pathname + window.location.search;
    if (here !== '/') sessionStorage.setItem(RETURN_KEY, here);
  } catch {
    // Storage blocked: the user lands on the home screen instead.
  }
}

export function takeReturnTo(): string | null {
  try {
    const to = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return to && to.startsWith('/') ? to : null;
  } catch {
    return null;
  }
}
