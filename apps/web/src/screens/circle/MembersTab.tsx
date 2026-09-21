import { useState, type FormEvent } from 'react';
import {
  adminAdjustCoins,
  getMembers,
  leaveCircle,
  removeMember,
  renameMember,
  setMemberRole,
  type Circle,
  type CircleMember,
} from '../../lib';
import { useResource, useRunner } from '../../hooks';
import { navigate } from '../../router';
import { coins } from '../../format';
import { ConfirmButton, ErrorNote, Loading, Pill, useToast } from '../../ui';

export default function MembersTab({
  circle,
  me,
  onChanged,
}: {
  circle: Circle;
  me: CircleMember;
  onChanged: () => void;
}) {
  const members = useResource(() => getMembers(circle.id), [circle.id]);
  const leave = useRunner();
  const iAmAdmin = me.role === 'admin';
  const iAmCreator = circle.created_by === me.user_id;

  const changed = () => {
    void members.reload();
    onChanged();
  };

  async function onLeave() {
    const res = await leave.run(() => leaveCircle(circle.id), 'You left the circle');
    if (res.error === undefined) navigate('/');
  }

  if (members.loading) return <Loading />;
  if (!members.data) {
    return <ErrorNote message={members.error ?? 'Could not load members.'} onRetry={members.reload} />;
  }

  return (
    <div className="stack">
      <ul className="list">
        {members.data.map((m) => (
          <MemberRow
            key={m.user_id}
            member={m}
            circleId={circle.id}
            isMe={m.user_id === me.user_id}
            isCreator={m.user_id === circle.created_by}
            iAmAdmin={iAmAdmin}
            onChanged={changed}
          />
        ))}
      </ul>

      <RenameForm circleId={circle.id} current={me.display_name ?? ''} onChanged={changed} />

      <div className="card stack">
        <h2>Leave this circle</h2>
        {iAmCreator ? (
          <p className="hint">You started this circle, so you cannot leave it.</p>
        ) : (
          <>
            <p className="hint">
              You lose access to its markets and history. Not allowed while you have open bets or
              a bond in escrow.
            </p>
            <ConfirmButton onConfirm={onLeave} disabled={leave.busy}>
              Leave circle
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  );
}

function RenameForm({
  circleId,
  current,
  onChanged,
}: {
  circleId: number;
  current: string;
  onChanged: () => void;
}) {
  const [name, setName] = useState(current);
  const runner = useRunner();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await runner.run(() => renameMember(circleId, name.trim()), 'Name updated');
    if (res.error === undefined) onChanged();
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>Your name in this circle</h2>
      <label className="field">
        <span>Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <button className="btn" disabled={runner.busy || !name.trim() || name.trim() === current}>
        Save name
      </button>
    </form>
  );
}

function MemberRow({
  member,
  circleId,
  isMe,
  isCreator,
  iAmAdmin,
  onChanged,
}: {
  member: CircleMember;
  circleId: number;
  isMe: boolean;
  isCreator: boolean;
  iAmAdmin: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const runner = useRunner();

  async function adjust(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0) {
      toast('Enter a whole number of coins. A negative number takes coins away.', 'error');
      return;
    }
    const res = await runner.run(
      () => adminAdjustCoins(circleId, member.user_id, n, note.trim() || 'Admin adjustment'),
      'Balance updated',
    );
    if (res.error === undefined) {
      setAmount('');
      setNote('');
      onChanged();
    }
  }

  async function toggleRole() {
    const next = member.role === 'admin' ? 'member' : 'admin';
    const res = await runner.run(
      () => setMemberRole(circleId, member.user_id, next),
      next === 'admin' ? 'Promoted to admin' : 'Changed to member',
    );
    if (res.error === undefined) onChanged();
  }

  async function remove() {
    const res = await runner.run(() => removeMember(circleId, member.user_id), 'Member removed');
    if (res.error === undefined) onChanged();
  }

  return (
    <li className="card stack">
      <div className="spread">
        <div>
          <strong>{member.display_name ?? 'Someone'}</strong>
          {isMe && <span className="muted"> (you)</span>}
          <p className="muted">{coins(member.balance)}</p>
        </div>
        <div className="row">
          {isCreator && <Pill tone="muted">Creator</Pill>}
          {member.role === 'admin' && <Pill tone="accent">Admin</Pill>}
          {iAmAdmin && (
            <button
              type="button"
              className="btn small ghost"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Close' : 'Manage'}
            </button>
          )}
        </div>
      </div>

      {iAmAdmin && open && (
        <div className="stack manage">
          <form className="row form-row" onSubmit={adjust}>
            <label className="field">
              <span>Coins (+/-)</span>
              <input
                type="number"
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
                required
              />
            </label>
            <label className="field grow">
              <span>Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why" />
            </label>
            <button className="btn" disabled={runner.busy}>
              Apply
            </button>
          </form>

          <div className="row">
            {!isCreator && (
              <button type="button" className="btn small" onClick={toggleRole} disabled={runner.busy}>
                {member.role === 'admin' ? 'Make member' : 'Make admin'}
              </button>
            )}
            {!isMe && !isCreator && (
              <ConfirmButton className="btn small danger" onConfirm={remove} disabled={runner.busy}>
                Remove from circle
              </ConfirmButton>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
