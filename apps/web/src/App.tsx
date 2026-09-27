import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { getNotifications } from './lib';
import { MeContext, profileOf, useAuthUser, useMe } from './hooks';
import { Link, match, navigate, takeReturnTo, toId, usePath } from './router';
import { Loading, ToastProvider } from './ui';
import { BellIcon } from './icons';
import SignIn from './screens/SignIn';
import Circles from './screens/Circles';
import CircleScreen from './screens/Circle';
import NewMarket from './screens/NewMarket';
import MarketScreen from './screens/Market';
import Notifications from './screens/Notifications';
import Profile from './screens/Profile';

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

  if (match('/profile', path)) return <Profile />;

  return (
    <div className="stack">
      <h1>Page not found</h1>
      <Link to="/" className="btn">
        Back to your circles
      </Link>
    </div>
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
  const path = usePath();
  const [unread, setUnread] = useState(0);
  const me = useMe();
  const { firstName, avatarUrl } = profileOf(me);
  const [avatarBroken, setAvatarBroken] = useState(false);

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

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            Private Market
          </Link>
          <nav className="row">
            <Link
              to="/notifications"
              className="btn small ghost icon-btn"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              title={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <BellIcon />
              {unread > 0 && <span className="badge badge-corner">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <Link to="/profile" className="whoami" title="Profile">
              {avatarUrl && !avatarBroken ? (
                <img
                  className="avatar"
                  src={avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <span className="avatar avatar-fallback" aria-hidden="true">
                  {firstName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="whoami-name">Profile</span>
            </Link>
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
