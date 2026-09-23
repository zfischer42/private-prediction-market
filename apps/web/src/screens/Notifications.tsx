import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../lib';
import { useResource, useRunner } from '../hooks';
import { navigate } from '../router';
import { relative } from '../format';
import { Empty, ErrorNote, Loading } from '../ui';

export default function Notifications() {
  const list = useResource(() => getNotifications({ limit: 100 }), []);
  const marking = useRunner();

  async function open(n: Notification) {
    // Best effort: failing to mark one read should not stop the navigation.
    if (!n.read_at) void markNotificationRead(n.id);
    if (n.url && n.url.startsWith('/')) navigate(n.url);
    else void list.reload();
  }

  async function markAll() {
    const res = await marking.run(() => markAllNotificationsRead());
    if (res.error === undefined) void list.reload();
  }

  if (list.loading) return <Loading />;
  if (!list.data) {
    return <ErrorNote message={list.error ?? 'Could not load notifications.'} onRetry={list.reload} />;
  }

  const unread = list.data.filter((n) => !n.read_at).length;

  return (
    <div className="stack">
      <div className="spread">
        <h1>Alerts</h1>
        {unread > 0 && (
          <button type="button" className="btn small" onClick={markAll} disabled={marking.busy}>
            Mark all read
          </button>
        )}
      </div>

      {list.data.length === 0 ? (
        <Empty>Nothing yet. Alerts show up here when a market is about to close or gets settled.</Empty>
      ) : (
        <ul className="list">
          {list.data.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`card link notification${n.read_at ? '' : ' unread'}`}
                onClick={() => void open(n)}
              >
                <strong>{n.title}</strong>
                <span>{n.body}</span>
                <span className="muted small">{relative(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
