import { useEffect, useState, type FormEvent } from 'react';
import {
  canProposeResolution,
  clearProposalVote,
  getProposalVotes,
  getProposals,
  isSettled,
  onProposalVotes,
  proposeResolution,
  resolveMarket,
  reviewProposal,
  voidMarket,
  voteOnProposal,
  type Market,
  type ProposalAction,
  type ResolutionProposal,
  type Vote,
} from '../../lib';
import { useResource, useRunner } from '../../hooks';
import { money, when, type Tone } from '../../format';
import { ConfirmButton, Pill, useToast } from '../../ui';
import PhotoInput from './PhotoInput';
import { MAX_PICK, uploadPhotos } from './photos';
import type { NameOf, OptionRow } from './types';

export default function ResolutionPanel({
  market,
  rows,
  nameOf,
  myId,
  isAdmin,
  bond,
  now,
  photoRoom,
  onPhotosChanged,
  onChanged,
}: {
  market: Market;
  rows: OptionRow[];
  nameOf: NameOf;
  myId: string;
  isAdmin: boolean;
  bond: number;
  now: Date;
  // How many more photos the market can take and how big each may be; null while unknown.
  photoRoom: { remaining: number; maxBytes: number } | null;
  onPhotosChanged: () => void;
  onChanged: () => void;
}) {
  const proposals = useResource(() => getProposals(market.id), [market.id]);
  const settled = isSettled(market);
  const winner = rows.find((r) => r.id === market.winning_option_id);
  const myPending = proposals.data?.some((p) => p.proposer_id === myId && p.status === 'pending');

  const changed = () => {
    void proposals.reload();
    onChanged();
  };

  return (
    <>
      <section className="card stack">
        <h2>Result</h2>

        {market.status === 'resolved' && (
          <p>
            Resolved: <strong>{winner?.label ?? 'unknown'}</strong>
            {market.resolved_at && <span className="muted"> on {when(market.resolved_at)}</span>}
          </p>
        )}
        {market.status === 'voided' && (
          <p>This market was voided and every stake was refunded.</p>
        )}

        {!settled &&
          (canProposeResolution(market, now) ? (
            myPending ? (
              <p className="hint">You have proposed a result. It is waiting for an admin to review it.</p>
            ) : (
              <ProposeForm
                market={market}
                rows={rows}
                bond={bond}
                photoRoom={photoRoom}
                onPhotosChanged={onPhotosChanged}
                onDone={changed}
              />
            )
          ) : (
            <p className="hint">
              Once the event is over ({when(market.event_end_at ?? market.closes_at)}), anyone in the
              circle can propose how it turned out.
            </p>
          ))}
      </section>

      {proposals.data && proposals.data.length > 0 && (
        <section className="stack">
          <h2>Proposed results</h2>
          <ul className="list">
            {proposals.data.map((p) => (
              <li key={p.id}>
                <ProposalCard
                  proposal={p}
                  optionLabel={p.option.label}
                  nameOf={nameOf}
                  myId={myId}
                  isAdmin={isAdmin}
                  onChanged={changed}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && !settled && <AdminTools market={market} rows={rows} onChanged={changed} />}
    </>
  );
}

function ProposeForm({
  market,
  rows,
  bond,
  photoRoom,
  onPhotosChanged,
  onDone,
}: {
  market: Market;
  rows: OptionRow[];
  bond: number;
  photoRoom: { remaining: number; maxBytes: number } | null;
  onPhotosChanged: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [optionId, setOptionId] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const runner = useRunner();
  const photoSlots = photoRoom ? Math.min(MAX_PICK, photoRoom.remaining) : 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await runner.run(
      () => proposeResolution(market.id, Number(optionId), note.trim() || undefined),
      'Result proposed',
    );
    if (res.error !== undefined) return;

    // The proposal exists now; photos ride along afterwards, tagged to it. If they fail the
    // proposal stands, and the photos can be added from the Photos section.
    const attached = photos;
    setOptionId('');
    setNote('');
    setPhotos([]);
    if (attached.length > 0 && photoRoom) {
      const up = await uploadPhotos(attached, {
        marketId: market.id,
        proposalId: res.data,
        maxBytes: photoRoom.maxBytes,
      });
      if (up.error !== undefined) {
        toast(`Result proposed, but ${up.added > 0 ? 'some photos' : 'the photos'} could not be added: ${up.error}`, 'error');
      }
      if (up.added > 0) onPhotosChanged();
    }
    onDone();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <p className="hint">
        Know how it ended? Propose the result for an admin to confirm.{' '}
        {bond > 0
          ? `It costs a ${money(bond)} bond, returned if it is approved and lost if it turns out to be a false alarm.`
          : 'There is no bond in this circle.'}{' '}
        Betting stays open meanwhile, but bets placed after a proposal on the winning side are
        refunded once it is approved.
      </p>
      <label className="field">
        <span>What happened</span>
        <select value={optionId} onChange={(e) => setOptionId(e.target.value)} required>
          <option value="">Choose the winning option</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Note (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="How do you know?"
        />
      </label>
      {photoSlots > 0 && (
        <div className="stack tight">
          <div className="row">
            <PhotoInput
              max={photoSlots}
              onPick={(files) => setPhotos((cur) => [...cur, ...files].slice(0, photoSlots))}
            >
              Attach photos
            </PhotoInput>
            <span className="hint">Optional, up to {photoSlots}. They are shrunk before they upload.</span>
          </div>
          {photos.length > 0 && (
            <div className="chips">
              {photos.map((file, i) => (
                <button
                  key={`${file.name}-${i}`}
                  type="button"
                  className="chip"
                  onClick={() => setPhotos((cur) => cur.filter((_, j) => j !== i))}
                >
                  {file.name} (remove)
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="btn primary" disabled={runner.busy || !optionId}>
        {runner.busy ? 'Proposing...' : 'Propose result'}
      </button>
    </form>
  );
}

const PROPOSAL_STATUS: Record<ResolutionProposal['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

function ProposalCard({
  proposal,
  optionLabel,
  nameOf,
  myId,
  isAdmin,
  onChanged,
}: {
  proposal: ResolutionProposal;
  optionLabel: string;
  nameOf: NameOf;
  myId: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const votes = useResource(() => getProposalVotes(proposal.id), [proposal.id]);
  const voting = useRunner();
  const reviewing = useRunner();
  const pending = proposal.status === 'pending';
  const status = PROPOSAL_STATUS[proposal.status];

  useEffect(
    () =>
      pending
        ? onProposalVotes(proposal.id, () => void votes.reload(), { onError: console.warn })
        : undefined,
    [proposal.id, pending, votes.reload],
  );

  const list = votes.data ?? [];
  const approve = list.filter((v) => v.vote === 'approve').length;
  const disapprove = list.length - approve;
  const mine = list.find((v) => v.user_id === myId)?.vote;

  // Tapping the vote you already cast takes it back.
  async function vote(v: Vote) {
    const res =
      mine === v
        ? await voting.run(() => clearProposalVote(proposal.id))
        : await voting.run(() => voteOnProposal(proposal.id, v));
    if (res.error === undefined) void votes.reload();
  }

  async function review(action: ProposalAction, success: string) {
    const res = await reviewing.run(() => reviewProposal(proposal.id, action), success);
    if (res.error === undefined) onChanged();
  }

  return (
    <div className="card stack">
      <div className="spread">
        <span>
          <strong>{nameOf(proposal.proposer_id)}</strong>{' '}
          {proposal.proposer_id === myId ? 'say' : 'says'} <strong>{optionLabel}</strong>
        </span>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      {proposal.note && <p className="note-text">{proposal.note}</p>}
      <p className="muted small">
        {when(proposal.created_at)} - bond {money(proposal.bond)}
      </p>

      {pending && (
        <>
          <div className="row">
            <span className="muted small">Members think:</span>
            <button
              type="button"
              className={`chip${mine === 'approve' ? ' on' : ''}`}
              aria-pressed={mine === 'approve'}
              onClick={() => void vote('approve')}
              disabled={voting.busy}
            >
              Looks right ({approve})
            </button>
            <button
              type="button"
              className={`chip${mine === 'disapprove' ? ' on' : ''}`}
              aria-pressed={mine === 'disapprove'}
              onClick={() => void vote('disapprove')}
              disabled={voting.busy}
            >
              Not right ({disapprove})
            </button>
          </div>
          <p className="hint">Votes are a poll for the admin - they do not decide anything.</p>

          {isAdmin && (
            <div className="row manage">
              <ConfirmButton
                className="btn small primary"
                confirmLabel="Confirm: pay out"
                onConfirm={() => void review('approve', 'Approved - the market is settled')}
                disabled={reviewing.busy}
              >
                Approve and pay out
              </ConfirmButton>
              <ConfirmButton
                className="btn small"
                confirmLabel="Confirm: false alarm"
                onConfirm={() => void review('reject_reopen', 'Rejected - betting continues')}
                disabled={reviewing.busy}
              >
                Reject, keep betting
              </ConfirmButton>
              <ConfirmButton
                className="btn small"
                confirmLabel="Confirm: stop betting"
                onConfirm={() => void review('reject_close', 'Rejected - betting is closed')}
                disabled={reviewing.busy}
              >
                Reject, stop betting
              </ConfirmButton>
              <ConfirmButton
                className="btn small danger"
                confirmLabel="Confirm: refund all"
                onConfirm={() => void review('void_market', 'Market voided and refunded')}
                disabled={reviewing.busy}
              >
                Void and refund
              </ConfirmButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AdminTools({
  market,
  rows,
  onChanged,
}: {
  market: Market;
  rows: OptionRow[];
  onChanged: () => void;
}) {
  const [winnerId, setWinnerId] = useState('');
  const [reason, setReason] = useState('');
  const resolving = useRunner();
  const voiding = useRunner();

  async function onResolve() {
    const res = await resolving.run(
      () => resolveMarket(market.id, Number(winnerId)),
      'Market resolved and paid out',
    );
    if (res.error === undefined) onChanged();
  }

  async function onVoid() {
    const res = await voiding.run(
      () => voidMarket(market.id, reason.trim()),
      'Market voided and refunded',
    );
    if (res.error === undefined) onChanged();
  }

  return (
    <details className="card">
      <summary>Admin tools</summary>
      <div className="stack">
        <div className="stack">
          <h3>Resolve directly</h3>
          <p className="hint">Skips the proposal flow. Pays out everyone who backed the winner, immediately.</p>
          <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)} aria-label="Winning option">
            <option value="">Choose the winning option</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <ConfirmButton
            className="btn primary"
            confirmLabel="Confirm: resolve and pay out"
            onConfirm={() => void onResolve()}
            disabled={resolving.busy || !winnerId}
          >
            Resolve market
          </ConfirmButton>
        </div>

        <div className="stack">
          <h3>Void the market</h3>
          <p className="hint">Calls it off. Every stake and bond is refunded and nobody wins.</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            aria-label="Reason for voiding"
          />
          <ConfirmButton
            confirmLabel="Confirm: void and refund"
            onConfirm={() => void onVoid()}
            disabled={voiding.busy || !reason.trim()}
          >
            Void market
          </ConfirmButton>
        </div>
      </div>
    </details>
  );
}
