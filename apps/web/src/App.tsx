import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { getNotifications, signOut } from './lib';
import { MeContext, useAuthUser, useMe, useTheme } from './hooks';
import { Link, match, navigate, takeReturnTo, toId, usePath } from './router';
import { Loading, ToastProvider, useToast } from './ui';
import SignIn from './screens/SignIn';
import Circles from './screens/Circles';
import CircleScreen from './screens/Circle';
import NewMarket from './screens/NewMarket';
import MarketScreen from './screens/Market';
import Notifications from './screens/Notifications';

export default function App() {
  return (
    <ToastProvider>
      <Gate />
    </ToastProvider>
  );
}

function Gate() {
  const user = useAuthUser();

  // Back from Google: pick up where the person was headed.
  useEffect(() => {
    if (!user) return;
    const to = takeReturnTo();
    if (to) navigate(to, { replace: true });
  }, [user?.id]);

  if (user === undefined) {
    return (
      <div className="splash">
        <Loading />
      </div>
    );
  }
  if (user === null) {
    return (
      <>
        <InstallHint />
        <SignIn />
      </>
    );
  }

  // Keyed by user so a change of identity can never leave the previous person's data on screen.
  return (
    <MeContext.Provider key={user.id} value={user}>
      <InstallHint />
      <Shell>
        <Routes />
      </Shell>
    </MeContext.Provider>
  );
}

function Routes() {
  const path = usePath();

  if (match('/', path)) return <Circles />;

  const circle = match('/circle/:id', path);
  const circleId = toId(circle?.id);
  if (circleId) return <CircleScreen key={circleId} circleId={circleId} />;

  const newMarket = match('/circle/:id/new-market', path);
  const newMarketCircleId = toId(newMarket?.id);
  if (newMarketCircleId) return <NewMarket key={newMarketCircleId} circleId={newMarketCircleId} />;

  const market = match('/market/:id', path);
  const marketId = toId(market?.id);
  if (marketId) return <MarketScreen key={marketId} marketId={marketId} />;

  if (match('/notifications', path)) return <Notifications />;

  return (
    <div className="stack">
      <h1>Page not found</h1>
      <Link to="/" className="btn">
        Back to your circles
      </Link>
    </div>
  );
}

// A plain sun/moon glyph, not an icon-set dependency - this is the only
// icon the app needs today. Reach for a real icon set (see DESIGN.md)
// before a second one shows up.
function ThemeIcon({ theme }: { theme: 'dark' | 'light' }) {
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
      <path
        fill="currentColor"
        d="M13.5 9.7A5.75 5.75 0 0 1 6.3 2.5a5.75 5.75 0 1 0 7.2 7.2Z"
      />
    </svg>
  );
}

function BellIcon() {
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

const INSTALL_HINT_SEEN_KEY = 'ppm_install_hint_seen';

// Shown once, the first time this browser opens the app, on whichever screen
// that happens to be (sign-in or straight into a circle). There is no
// beforeinstallprompt on iOS Safari - the only "install" that exists there is
// Share -> Add to Home Screen, and nothing tells a person that unless the
// page does. Once dismissed, or once already running installed, it is gone
// for good - localStorage remembers per browser, not per account.
function InstallHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_HINT_SEEN_KEY) === '1';
    } catch {
      return true; // can't remember the dismissal, so don't risk nagging every load
    }
  });

  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      // Older iOS Safari's own flag - there is no display-mode media query there.
      (window.navigator as { standalone?: boolean }).standalone === true);

  if (dismissed || standalone) return null;

  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_HINT_SEEN_KEY, '1');
    } catch {
      // No storage (private mode, etc.) - it just asks again next time.
    }
    setDismissed(true);
  }

  return (
    <div
      style={{
        padding: '0.75rem max(1rem, env(safe-area-inset-right)) 0 max(1rem, env(safe-area-inset-left))',
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
      }}
    >
      <div className="note" style={{ maxWidth: '42rem', margin: '0 auto' }}>
        <p className="small" style={{ margin: 0 }}>
          {isIOS ? (
            <>
              Add this to your home screen: tap <strong>Share</strong>, then{' '}
              <strong>Add to Home Screen</strong>.
            </>
          ) : (
            <>
              Add this to your home screen from your browser's menu - it opens full-screen next
              time, just like an app.
            </>
          )}
        </p>
        <button type="button" className="btn small ghost" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const toast = useToast();
  const path = usePath();
  const [unread, setUnread] = useState(0);
  const me = useMe();
  const meta = (me.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = [meta.full_name, meta.name].find((v) => typeof v === 'string' && v) as
    | string
    | undefined;
  const firstName = (fullName ?? me.email ?? '').split(/[\s@]/)[0];
  const avatar = [meta.avatar_url, meta.picture].find((v) => typeof v === 'string' && v) as
    | string
    | undefined;
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [theme, setTheme] = useTheme();

  // Notifications are not published to realtime, so refresh the badge as the person moves around.
  useEffect(() => {
    let live = true;
    void getNotifications({ unreadOnly: true, limit: 99 }).then((res) => {
      if (live && res.error === undefined) setUnread(res.data.length);
    });
    return () => {
      live = false;
    };
  }, [path]);

  async function onSignOut() {
    const res = await signOut();
    if (res.error !== undefined) toast(res.error, 'error');
    else navigate('/', { replace: true });
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            Private Market
          </Link>
          <nav className="row">
            <span className="whoami" title={me.email ?? undefined}>
              {avatar && !avatarBroken ? (
                <img
                  className="avatar"
                  src={avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <span className="avatar avatar-fallback" aria-hidden="true">
                  {firstName.charAt(0).toUpperCase()}
                </span>
              )}
              {firstName && <span className="whoami-name">Welcome, {firstName}</span>}
            </span>
            <Link
              to="/notifications"
              className="btn small ghost icon-btn"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              title={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <BellIcon />
              {unread > 0 && <span className="badge badge-corner">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <button
              type="button"
              className="btn small ghost icon-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <ThemeIcon theme={theme} />
            </button>
            <button type="button" className="btn small ghost" onClick={onSignOut}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="container">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={path}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </>
  );
}
