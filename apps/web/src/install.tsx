import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown, CloseIcon, MoreVertIcon, PlusSquareIcon, ShareIcon } from './icons';

// Chrome/Edge/Android fire this once, early, when the page is installable. It
// has to be caught at module load or it is gone before any component mounts.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function useDeferredPrompt() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred,
  );
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Older iOS Safari's own flag - there is no display-mode media query there.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

type Platform = 'ios' | 'ios-other-browser' | 'ios-in-app' | 'android' | 'other';

function platform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) {
    // Links shared in a group chat often open in an app's built-in browser,
    // which has no Add to Home Screen at all.
    if (/FBAN|FBAV|Instagram|Snapchat|Line\/|LinkedInApp|musical_ly|Bytedance|Twitter|GSA\//i.test(ua)) {
      return 'ios-in-app';
    }
    if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'ios-other-browser';
    return 'ios';
  }
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

const SEEN_KEY = 'ppm_install_hint_seen';

// A slim bar, shown until dismissed, that opens the step-by-step sheet.
// localStorage remembers per browser, not per account.
export function InstallBar() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return true; // can't remember the dismissal, so don't risk nagging every load
    }
  });
  const [open, setOpen] = useState(false);

  if (dismissed || isStandalone()) return null;

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // No storage (private mode, etc.) - it just shows again next time.
    }
    setDismissed(true);
  }

  return (
    <div className="install-wrap">
      <div className="install-bar">
        <span className="brand-mark">$</span>
        <div className="grow">
          <strong>Get the app</strong>
          <span className="muted small">Add it to your Home Screen</span>
        </div>
        <button type="button" className="btn small primary" onClick={() => setOpen(true)}>
          Show me
        </button>
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
          <CloseIcon />
        </button>
      </div>
      {open && <InstallSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

// For places that want a plain "how do I install this?" link.
export function InstallLink({ className = 'text-btn' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  if (isStandalone()) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Add to Home Screen
      </button>
      {open && <InstallSheet onClose={() => setOpen(false)} />}
    </>
  );
}

const Glyph = ({ children }: { children: ReactNode }) => <span className="glyph">{children}</span>;

export function InstallSheet({ onClose }: { onClose: () => void }) {
  const prompt = useDeferredPrompt();
  const os = platform();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Otherwise iOS scrolls the page behind the sheet when a swipe overshoots it.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    deferred = null;
    notify();
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet stack"
        role="dialog"
        aria-modal="true"
        aria-label="Add to Home Screen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" />
        <div className="spread">
          <h2>Add to Home Screen</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <p className="hint">It opens full-screen like an app, with no browser bars.</p>

        {prompt ? (
          <button type="button" className="btn primary block" onClick={() => void install()}>
            Install
          </button>
        ) : os === 'ios' ? (
          <ol className="steps">
            <li className="step">
              <p>
                Tap <Glyph><ShareIcon /></Glyph> <strong>Share</strong> in Safari's toolbar.
                <span className="muted small"> If you don't see it, tap ••• first.</span>
              </p>
            </li>
            <li className="step">
              <p>
                Tap <Glyph><ChevronDown /></Glyph> <strong>View More</strong> at the end of the row of
                actions.
              </p>
            </li>
            <li className="step">
              <p>
                Scroll down and tap <Glyph><PlusSquareIcon /></Glyph> <strong>Add to Home Screen</strong>.
              </p>
            </li>
            <li className="step">
              <p>
                Leave <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.
              </p>
            </li>
          </ol>
        ) : os === 'ios-in-app' ? (
          <ol className="steps">
            <li className="step">
              <p>
                This page is open inside another app, which can't add it to your Home Screen. Tap{' '}
                <strong>•••</strong> (or the compass icon) and choose <strong>Open in Safari</strong>.
              </p>
            </li>
            <li className="step">
              <p>
                In Safari, tap <strong>Show me</strong> again and follow the steps.
              </p>
            </li>
          </ol>
        ) : os === 'ios-other-browser' ? (
          <ol className="steps">
            <li className="step">
              <p>
                Tap <Glyph><ShareIcon /></Glyph> <strong>Share</strong> - in the address bar, or in
                the browser's menu.
              </p>
            </li>
            <li className="step">
              <p>
                Tap <Glyph><PlusSquareIcon /></Glyph> <strong>Add to Home Screen</strong>. If it
                isn't listed, open this page in Safari instead.
              </p>
            </li>
            <li className="step">
              <p>
                Tap <strong>Add</strong>.
              </p>
            </li>
          </ol>
        ) : os === 'android' ? (
          <ol className="steps">
            <li className="step">
              <p>
                Tap <Glyph><MoreVertIcon /></Glyph> in Chrome's top-right corner.
              </p>
            </li>
            <li className="step">
              <p>
                Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
              </p>
            </li>
            <li className="step">
              <p>
                Tap <strong>Install</strong>.
              </p>
            </li>
          </ol>
        ) : (
          <ol className="steps">
            <li className="step">
              <p>
                In Chrome or Edge, click the install icon at the right end of the address bar.
              </p>
            </li>
            <li className="step">
              <p>
                On a phone, open this page there instead - it is built for one.
              </p>
            </li>
          </ol>
        )}

        <button type="button" className="btn block" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
