import { useMemo, useState } from 'react';
import { getCircle, getMembers, getMyMembership } from '../lib';
import { useResource } from '../hooks';
import { Link } from '../router';
import { money } from '../format';
import { ErrorNote, Loading, useToast } from '../ui';
import MarketsTab from './circle/MarketsTab';
import StandingsTab from './circle/StandingsTab';
import ChatTab from './circle/ChatTab';
import MembersTab from './circle/MembersTab';
import SettingsTab from './circle/SettingsTab';

type Tab = 'markets' | 'standings' | 'chat' | 'members' | 'settings';

export default function CircleScreen({ circleId }: { circleId: number }) {
  const toast = useToast();
  const circle = useResource(() => getCircle(circleId), [circleId]);
  const me = useResource(() => getMyMembership(circleId), [circleId]);
  const members = useResource(() => getMembers(circleId), [circleId]);
  const [tab, setTab] = useState<Tab>('markets');

  const nameOf = useMemo(() => {
    const byId = new Map((members.data ?? []).map((m) => [m.user_id, m.display_name ?? 'Someone']));
    return (id: string) => (id === me.data?.user_id ? 'You' : (byId.get(id) ?? 'Someone'));
  }, [members.data, me.data?.user_id]);

  if (circle.loading || me.loading) return <Loading />;
  if (!circle.data) {
    return (
      <div className="stack">
        <Link to="/" className="back">&larr; All circles</Link>
        <ErrorNote message={circle.error ?? 'Circle not found'} onRetry={circle.reload} />
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="stack">
        <Link to="/" className="back">&larr; All circles</Link>
        <ErrorNote message={me.error ?? 'You are not a member of this circle.'} onRetry={me.reload} />
      </div>
    );
  }

  const membership = me.data;
  const isAdmin = membership.role === 'admin';
  const tabs: Array<[Tab, string]> = [
    ['markets', 'Markets'],
    ['standings', 'Standings'],
    ['chat', 'Chat'],
    ['members', 'Members'],
  ];
  if (isAdmin) tabs.push(['settings', 'Settings']);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(circle.data!.join_code);
      toast('Invite code copied');
    } catch {
      toast('Could not copy - select the code and copy it by hand.', 'error');
    }
  }

  return (
    <div className="stack">
      <Link to="/" className="back">&larr; All circles</Link>
      <h1>{circle.data.name}</h1>

      <div className="card spread">
        <div>
          <span className="label">Your balance</span>
          <strong className="big">{money(membership.balance)}</strong>
        </div>
        <div className="right">
          <span className="label">Invite code</span>
          <button type="button" className="code" onClick={copyCode} title="Copy invite code">
            {circle.data.join_code}
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? ' on' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'markets' && <MarketsTab circleId={circleId} />}
        {tab === 'standings' && <StandingsTab circleId={circleId} myId={membership.user_id} />}
        {tab === 'chat' && <ChatTab circleId={circleId} nameOf={nameOf} myId={membership.user_id} />}
        {tab === 'members' && (
          <MembersTab
            circle={circle.data}
            me={membership}
            onChanged={() => void me.reload()}
          />
        )}
        {tab === 'settings' && isAdmin && (
          <SettingsTab
            circle={circle.data}
            onSaved={() => void circle.reload()}
            onSeasonReset={() => void me.reload()}
          />
        )}
      </div>
    </div>
  );
}
