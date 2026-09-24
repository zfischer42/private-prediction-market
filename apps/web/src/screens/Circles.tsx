import { useState, type FormEvent } from 'react';
import { createCircle, getMyCircles, joinCircle, signOut } from '../lib';
import { useMe, useResource, useRunner } from '../hooks';
import { Link, navigate } from '../router';
import { money } from '../format';
import { Empty, ErrorNote, Loading, useToast } from '../ui';
import { ChevronRight } from '../icons';

type Form = 'none' | 'create' | 'join';

export default function Circles() {
  const me = useMe();
  const toast = useToast();
  const circles = useResource(() => getMyCircles(), []);
  const [form, setForm] = useState<Form>('none');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const creating = useRunner();
  const joining = useRunner();

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = await creating.run(() => createCircle(name.trim()));
    if (res.error === undefined) navigate(`/circle/${res.data}`);
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    const res = await joining.run(() => joinCircle(code.trim()));
    if (res.error === undefined) navigate(`/circle/${res.data}`);
  }

  async function onSignOut() {
    const res = await signOut();
    if (res.error !== undefined) toast(res.error, 'error');
    else navigate('/', { replace: true });
  }

  const toggle = (f: Form) => setForm((cur) => (cur === f ? 'none' : f));

  let list;
  if (circles.loading) {
    list = <Loading />;
  } else if (!circles.data) {
    list = <ErrorNote message={circles.error ?? 'Could not load your circles.'} onRetry={circles.reload} />;
  } else if (circles.data.length === 0) {
    list = (
      <Empty>
        You're not in any circles yet. Start one, or join a friend's with their 6-character code.
      </Empty>
    );
  } else {
    list = (
      <ul className="rows">
        {circles.data.map((row) => (
          <li key={row.circle_id}>
            <Link to={`/circle/${row.circle_id}`} className="circle-row">
              <span className="avatar">{row.circle.name.trim().charAt(0).toUpperCase()}</span>
              <span className="grow">
                <strong style={{ display: 'block' }}>{row.circle.name}</strong>
                <span className="muted small">{row.role === 'admin' ? 'Admin' : 'Member'}</span>
              </span>
              <strong className="tnum">{money(row.balance)}</strong>
              <ChevronRight className="chev" width={18} height={18} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="stack">
      <h1>Circles</h1>
      {list}

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button
          type="button"
          className={`btn${form === 'create' ? ' primary' : ''}`}
          onClick={() => toggle('create')}
          aria-expanded={form === 'create'}
        >
          New circle
        </button>
        <button
          type="button"
          className={`btn${form === 'join' ? ' primary' : ''}`}
          onClick={() => toggle('join')}
          aria-expanded={form === 'join'}
        >
          Join with code
        </button>
      </div>

      {form === 'create' && (
        <form className="card stack" onSubmit={onCreate}>
          <label className="field">
            <span>Circle name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Friday poker crew"
              autoFocus
              required
            />
          </label>
          <button className="btn primary" disabled={creating.busy || !name.trim()}>
            {creating.busy ? 'Creating...' : 'Create circle'}
          </button>
        </form>
      )}

      {form === 'join' && (
        <form className="card stack" onSubmit={onJoin}>
          <label className="field">
            <span>Invite code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={12}
              placeholder="A1B2C3"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              required
            />
          </label>
          <button className="btn primary" disabled={joining.busy || !code.trim()}>
            {joining.busy ? 'Joining...' : 'Join circle'}
          </button>
        </form>
      )}

      <div className="center stack tight" style={{ marginTop: '1.5rem' }}>
        <span className="muted small">Signed in as {me.email}</span>
        <div>
          <button type="button" className="text-btn" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
