import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { onAuthChange, type Result } from './lib';
import { useToast } from './ui';

// ---- Who is signed in -------------------------------------------------

// undefined = still finding out, null = signed out.
export function useAuthUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthChange(setUser), []);
  return user;
}

export const MeContext = createContext<User | null>(null);

export function useMe(): User {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() was called outside a signed-in screen');
  return me;
}

// ---- Loading data -----------------------------------------------------

export interface Resource<T> {
  data?: T;
  error?: string;
  // True only until the first result. A reload keeps showing the old data.
  loading: boolean;
  reload: () => Promise<void>;
}

// Runs a lib call and keeps its { data } | { error } result in state. Results
// that arrive after the inputs changed or the screen unmounted are dropped.
export function useResource<T>(
  load: () => Promise<Result<T>>,
  deps: DependencyList,
): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const fetchNow = useCallback(async () => {
    const id = ++latest.current;
    const res = await loader.current();
    if (id !== latest.current) return;
    setState((prev) =>
      res.error !== undefined
        ? { data: prev.data, error: res.error, loading: false }
        : { data: res.data, loading: false },
    );
  }, []);

  useEffect(() => {
    setState({ loading: true });
    void fetchNow();
    return () => {
      latest.current++;
    };
    // deps are the caller's; fetchNow is stable.
  }, deps);

  return { ...state, reload: fetchNow };
}

// ---- Doing things -----------------------------------------------------

// Wraps a button's action: tracks "busy", toasts the error if there is one,
// and hands the result back so the caller can decide what happens next.
export function useRunner() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T>(fn: () => Promise<Result<T>>, success?: string): Promise<Result<T>> => {
      setBusy(true);
      const res = await fn();
      setBusy(false);
      if (res.error !== undefined) toast(res.error, 'error');
      else if (success) toast(success);
      return res;
    },
    [toast],
  );

  return { busy, run };
}

// A clock that re-renders the caller, so "closes in 3m" and the betting
// window's open/closed state stay true while the screen is left open.
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}
