import { useEffect, useMemo } from 'react';
import {
  cancelMarket,
  getCircle,
  getEvidence,
  getEvidenceUploadStatus,
  getMarketBets,
  getMarketWithOptions,
  getMembers,
  getMyMembership,
  getOdds,
  isBettingOpen,
  isSettled,
  onMarketBets,
  onMarketChange,
  removeMarketFiles,
  type Market,
  type MarketOption,
} from '../lib';
import { useMe, useNow, useResource, useRunner } from '../hooks';
import { Link, navigate } from '../router';
import { kindLabel, money, percent, phaseOf, when } from '../format';
import { ConfirmButton, ErrorNote, Loading, Pill } from '../ui';
import { ChevronLeft } from '../icons';
import OptionsPanel from './market/OptionsPanel';
import BetPanel from './market/BetPanel';
import { AllBets, MyBets } from './market/BetsList';
import ResolutionPanel from './market/ResolutionPanel';
import EvidencePanel from './market/EvidencePanel';
import type { NameOf, OptionRow } from './market/types';

export default function MarketScreen({ marketId }: { marketId: number }) {
  const market = useResource(() => getMarketWithOptions(marketId), [marketId]);

  if (market.loading) return <Loading />;
  if (!market.data) {
    return (
      <div className="stack">
        <Link to="/" className="back">&larr; All circles</Link>
        <ErrorNote message={market.error ?? 'Market not found'} onRetry={market.reload} />
      </div>
    );
  }
  return <MarketView market={market.data} reloadMarket={market.reload} />;
}

function MarketView({
  market,
  reloadMarket,
}: {
  market: Market & { options: MarketOption[] };
  reloadMarket: () => Promise<void>;
}) {
  const me = useMe();
  const now = useNow();
  const cancelling = useRunner();

  const circle = useResource(() => getCircle(market.circle_id), [market.circle_id]);
  const membership = useResource(() => getMyMembership(market.circle_id), [market.circle_id]);
  const members = useResource(() => getMembers(market.circle_id), [market.circle_id]);
  const odds = useResource(() => getOdds(market.id), [market.id]);
  const bets = useResource(() => getMarketBets(market.id), [market.id]);
  const evidence = useResource(() => getEvidence(market.id), [market.id]);
  const evidenceStatus = useResource(() => getEvidenceUploadStatus(market.id), [market.id]);

  // Realtime is a nudge, not data: refetch rather than patching state from the payload.
  useEffect(() => {
    const onError = (message: string) => console.warn(message);
    const stops = [
      onMarketBets(
        market.id,
        () => {
          void odds.reload();
          void bets.reload();
        },
        { onError },
      ),
      onMarketChange(market.id, () => void reloadMarket(), { onError }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [market.id, odds.reload, bets.reload, reloadMarket]);

  const nameOf: NameOf = useMemo(() => {
    const byId = new Map((members.data ?? []).map((m) => [m.user_id, m.display_name ?? 'Someone']));
    return (id) => (id === me.id ? 'You' : (byId.get(id) ?? 'Someone'));
  }, [members.data, me.id]);

  if (circle.loading || membership.loading) return <Loading />;
  if (!circle.data || !membership.data) {
    return (
      <div className="stack">
        <Link to="/" className="back">&larr; All circles</Link>
        <ErrorNote
          message={circle.error ?? membership.error ?? 'You are not a member of this circle.'}
          onRetry={() => {
            void circle.reload();
            void membership.reload();
          }}
        />
      </div>
    );
  }

  const isAdmin = membership.data.role === 'admin';
  const settled = isSettled(market);
  const phase = phaseOf(market, now);
  const aboutMe = market.subject_id === me.id;

  const rows: OptionRow[] = [...market.options]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => {
      const od = odds.data?.find((x) => x.option_id === o.id);
      return { ...o, pool: od?.pool ?? 0, betCount: od?.bet_count ?? 0, pct: od?.pct ?? null };
    });

  const allBets = bets.data ?? [];
  const myBets = allBets.filter((b) => b.user_id === me.id);

  let blockedReason: string | null = null;
  if (aboutMe) {
    blockedReason = "This market is about you, so you can't bet on it.";
  } else if (!isBettingOpen(market, now)) {
    blockedReason =
      now < new Date(market.opens_at) ? `Betting opens ${when(market.opens_at)}.` : 'Betting has closed.';
  }

  const refreshMoney = () => {
    void odds.reload();
    void bets.reload();
    void membership.reload();
  };
  const refreshAll = () => {
    void reloadMarket();
    refreshMoney();
  };

  const canCancel = !settled && allBets.length === 0 && (isAdmin || market.creator_id === me.id);

  const refreshPhotos = () => {
    void evidence.reload();
    void evidenceStatus.reload();
  };
  const photoStatus = evidenceStatus.data;
  const photoRoom =
    photoStatus?.allowed ? { remaining: photoStatus.max_files - photoStatus.files, maxBytes: photoStatus.max_file_bytes } : null;

  async function onCancel() {
    // Photos first. Once the market row is gone nobody is allowed to delete its files, so
    // they would sit in storage, unreachable and still counting against the quota.
    const files = await cancelling.run(() => removeMarketFiles(market.id));
    if (files.error !== undefined) return;
    const res = await cancelling.run(() => cancelMarket(market.id), 'Market cancelled');
    if (res.error === undefined) navigate(`/circle/${market.circle_id}`);
  }

  const paired = market.kind === 'binary' || market.kind === 'over_under';
  const totalPool = rows.reduce((sum, r) => sum + Number(r.pool), 0);
  const leader = [...rows].sort((a, b) => Number(b.pct ?? 0) - Number(a.pct ?? 0))[0];
  const headline = settled ? null : paired ? rows[0] : leader;

  return (
    <div className="stack">
      <Link to={`/circle/${market.circle_id}`} className="back">
        <ChevronLeft width={18} height={18} /> {circle.data.name}
      </Link>

      <div className="stack tight">
        <div className="row">
          <Pill tone={phase.tone}>{phase.label}</Pill>
          <span className="muted small">{kindLabel(market)}</span>
        </div>
        <h1>{market.question}</h1>
        {market.subject_id && <p className="muted small">About {nameOf(market.subject_id)}</p>}
      </div>

      {headline && headline.pct !== null && (
        <div className="hero-chance">
          <strong className={paired ? 'gain' : undefined}>{percent(headline.pct)}</strong>
          <span>{paired ? `chance of ${headline.label}` : `${headline.label} leads`}</span>
        </div>
      )}

      <p className="muted small tnum">
        {money(totalPool)} pool ·{' '}
        {market.closes_at === null
          ? <>No scheduled close - open until someone reports what happened.</>
          : <>Closes {when(market.closes_at)} · Result by {when(market.event_end_at ?? market.closes_at)}</>}
      </p>

      {!settled && (
        <BetPanel
          market={market}
          rows={rows}
          balance={membership.data.balance}
          blockedReason={blockedReason}
          onPlaced={refreshMoney}
        />
      )}

      <OptionsPanel market={market} rows={rows} now={now} onChanged={refreshAll} />

      <MyBets bets={myBets} rows={rows} />

      <ResolutionPanel
        market={market}
        rows={rows}
        nameOf={nameOf}
        myId={me.id}
        isAdmin={isAdmin}
        bond={circle.data.proposal_bond}
        now={now}
        photoRoom={photoRoom}
        onPhotosChanged={refreshPhotos}
        onChanged={refreshAll}
      />

      <EvidencePanel
        market={market}
        evidence={evidence}
        status={evidenceStatus}
        nameOf={nameOf}
        myId={me.id}
        isAdmin={isAdmin}
        now={now}
        onChanged={refreshPhotos}
      />

      <AllBets
        bets={allBets}
        rows={rows}
        nameOf={nameOf}
        canVoid={isAdmin && !settled}
        onChanged={refreshMoney}
      />

      {canCancel && (
        <div className="card stack">
          <h2>Cancel this market</h2>
          <p className="hint">Deletes it entirely. Only possible while nobody has bet.</p>
          <ConfirmButton onConfirm={() => void onCancel()} disabled={cancelling.busy}>
            Cancel market
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
