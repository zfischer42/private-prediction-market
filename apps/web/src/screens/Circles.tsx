import { useState, type FormEvent } from 'react';
import { createCircle, getMyCircles, joinCircle } from '../lib';
import { useResource, useRunner } from '../hooks';
import { Link, navigate } from '../router';
import { money } from '../format';
import { Empty, ErrorNote, Loading, Pill } from '../ui';

export default function Circles() {
  const circles = useResource(() => getMyCircles(), []);
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

  let list;
  if (circles.loading) {
    list = <Loading />;
  } else if (!circles.data) {
    list = <ErrorNote message={circles.error ?? 'Could not load your circles.'} onRetry={circles.reload} />;
  } else if (circles.data.length === 0) {
    list = (
      <Empty>
        You are not in any circles yet. Start one below, or join a friend's with their
        6-character code.
      </Empty>
    );
  } else {
    list = (
      <ul className="list">
        {circles.data.map((row) => (
          <li key={row.circle_id}>
            <Link to={`/circle/${row.circle_id}`} className="card link">
              <div className="spread">
                <strong>{row.circle.name}</strong>
                {row.role === 'admin' && <Pill tone="accent">Admin</Pill>}
              </div>
              <p className="muted">{money(row.balance)}</p>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="stack">
      <h1>Your circles</h1>
      {list}

      <div className="grid-2">
        <form className="card stack" onSubmit={onCreate}>
          <h2>Start a circle</h2>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Friday poker crew"
              required
            />
          </label>
          <button className="btn primary" disabled={creating.busy || !name.trim()}>
            {creating.busy ? 'Creating...' : 'Create circle'}
          </button>
        </form>

        <form className="card stack" onSubmit={onJoin}>
          <h2>Join with a code</h2>
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
              required
            />
          </label>
          <button className="btn primary" disabled={joining.busy || !code.trim()}>
            {joining.busy ? 'Joining...' : 'Join circle'}
          </button>
        </form>
      </div>
    </div>
  );
}
