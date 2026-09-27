import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.kind}`}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ---- Small pieces -----------------------------------------------------

export function Pill({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`pill ${tone}${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <p className="muted center" role="status">
      {label}
    </p>
  );
}

// A card-shaped placeholder for a whole screen's first load, so the page
// doesn't flash from blank to "Loading..." to content. `lines` sets how
// many bars and their relative widths.
export function Skeleton({ lines = [100, 60, 80] }: { lines?: number[] }) {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      {lines.map((w, i) => (
        <div key={i} className="skeleton-line" style={{ '--w': `${w}%` } as CSSProperties} />
      ))}
    </div>
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
