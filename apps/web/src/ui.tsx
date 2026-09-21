import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Tone } from './format';

// ---- Toasts -----------------------------------------------------------

type ToastKind = 'ok' | 'error';
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, kind, text }]);
    window.setTimeout(
      () => setItems((list) => list.filter((t) => t.id !== id)),
      kind === 'error' ? 6000 : 3500,
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- Small pieces -----------------------------------------------------

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <p className="muted center" role="status">
      {label}
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="note error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn small ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// Two taps for anything that moves money or cannot be undone. The first tap
// arms it; it disarms itself after a few seconds so it cannot be tripped later.
export function ConfirmButton({
  children,
  onConfirm,
  className = 'btn danger',
  confirmLabel = 'Tap again to confirm',
  disabled,
}: {
  children: ReactNode;
  onConfirm: () => void;
  className?: string;
  confirmLabel?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${className}${armed ? ' armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
