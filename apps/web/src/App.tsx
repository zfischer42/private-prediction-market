import { useEffect, useState, type ReactNode } from 'react';
import { getNotifications } from './lib';
import { MeContext, useAuthUser } from './hooks';
import { Link, match, navigate, takeReturnTo, toId, usePath } from './router';
import { ToastProvider } from './ui';
import { InstallBar } from './install';
import { BellIcon } from './icons';
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
      <div className="splash" role="status" aria-label="Loading">
        <span className="brand-mark lg">$</span>
      </div>
    );
  }
  if (user === null) return <SignIn />;

  // Keyed by user so a change of identity can never leave the previous person's data on screen.
  return (
    <MeContext.Provider key={user.id} value={user}>
      <InstallBar />
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

function Shell({ children }: { children: ReactNode }) {
  const path = usePath();
  const [unread, setUnread] = useState(0);

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
            <span className="brand-mark">$</span>
            Private Market
          </Link>
          <Link
            to="/notifications"
            className="icon-btn"
            aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
          >
            <BellIcon />
            {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
          </Link>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
