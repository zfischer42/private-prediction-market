import { useEffect, useState } from 'react';
import {
  getBackendHealth,
  getCircles,
  getMarketBets,
  getMarketComments,
  getMarketOdds,
  getMarketOptions,
  getMarketProposals,
  getMarkets,
  getNotifications,
} from './api/backend';

export default function App() {
  const [backendStatus, setBackendStatus] = useState('Checking backend...');
  const [markets, setMarkets] = useState<Awaited<ReturnType<typeof getMarkets>>['markets']>([]);
  const [circles, setCircles] = useState<Awaited<ReturnType<typeof getCircles>>['circles']>([]);
  const [bets, setBets] = useState<Awaited<ReturnType<typeof getMarketBets>>['bets']>([]);
  const [proposals, setProposals] = useState<Awaited<ReturnType<typeof getMarketProposals>>['proposals']>([]);
  const [comments, setComments] = useState<Awaited<ReturnType<typeof getMarketComments>>['comments']>([]);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getMarketOptions>>['options']>([]);
  const [odds, setOdds] = useState<Awaited<ReturnType<typeof getMarketOdds>>['odds']>([]);
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof getNotifications>>['notifications']>([]);

  useEffect(() => {
    let active = true;

    getBackendHealth()
      .then(({ status }) => {
        if (active) {
          setBackendStatus(status === 'ok' ? 'Backend connected' : 'Backend unavailable');
        }
      })
      .catch(() => {
        if (active) setBackendStatus('Backend unavailable');
      });

    getMarkets()
      .then(({ markets: nextMarkets }) => {
        if (active) setMarkets(nextMarkets);
      })
      .catch(() => {
        if (active) setMarkets([]);
      });

    getCircles()
      .then(({ circles: nextCircles }) => {
        if (active) setCircles(nextCircles);
      })
      .catch(() => {
        if (active) setCircles([]);
      });

    getMarketBets('mkt-1')
      .then(({ bets: nextBets }) => {
        if (active) setBets(nextBets);
      })
      .catch(() => {
        if (active) setBets([]);
      });

    getMarketProposals('mkt-1')
      .then(({ proposals: nextProposals }) => {
        if (active) setProposals(nextProposals);
      })
      .catch(() => {
        if (active) setProposals([]);
      });

    getMarketComments('mkt-1')
      .then(({ comments: nextComments }) => {
        if (active) setComments(nextComments);
      })
      .catch(() => {
        if (active) setComments([]);
      });

    getMarketOptions('mkt-1')
      .then(({ options: nextOptions }) => {
        if (active) setOptions(nextOptions);
      })
      .catch(() => {
        if (active) setOptions([]);
      });

    getMarketOdds('mkt-1')
      .then(({ odds: nextOdds }) => {
        if (active) setOdds(nextOdds);
      })
      .catch(() => {
        if (active) setOdds([]);
      });

    getNotifications()
      .then(({ notifications: nextNotifications }) => {
        if (active) setNotifications(nextNotifications);
      })
      .catch(() => {
        if (active) setNotifications([]);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Private Prediction Market</p>
        <h1>Invite-only bets for friends, built for mobile first.</h1>
        <p className="lede">
          This starter shell is the first step toward the private market, invite,
          bet, and resolve loop defined in the architecture spine.
        </p>
        <p className="status">{backendStatus}</p>
      </section>

      <section className="circle-list">
        <h2>Your circles</h2>
        {circles.length === 0 ? (
          <p>No circles available yet.</p>
        ) : (
          circles.map((circle) => (
            <article key={circle.id} className="market-card">
              <h3>{circle.name}</h3>
              <p>{circle.memberCount} members</p>
              <p>{circle.season}</p>
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Open markets</h2>
        {markets.length === 0 ? (
          <p>No markets available yet.</p>
        ) : (
          markets.map((market) => (
            <article key={market.id} className="market-card">
              <h3>{market.question}</h3>
              <p>Status: {market.status}</p>
              <ul>
                {market.options.map((option) => (
                  <li key={option.id}>
                    {option.label}: {option.odds}
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Market bets</h2>
        {bets.length === 0 ? (
          <p>No bets placed yet.</p>
        ) : (
          bets.map((bet) => (
            <article key={bet.id} className="market-card">
              <h3>{bet.optionLabel}</h3>
              <p>Amount: {bet.amount}</p>
              <p>Status: {bet.status}</p>
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Market options</h2>
        {options.length === 0 ? (
          <p>No options available yet.</p>
        ) : (
          options.map((option) => (
            <article key={option.id} className="market-card">
              <h3>{option.label}</h3>
              <p>Sort order: {option.sortOrder}</p>
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Market odds</h2>
        {odds.length === 0 ? (
          <p>No odds available yet.</p>
        ) : (
          odds.map((entry) => (
            <article key={entry.optionId} className="market-card">
              <h3>{entry.label}</h3>
              <p>Pool: {entry.pool}</p>
              <p>Pct: {entry.pct ?? 'n/a'}</p>
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Resolution proposals</h2>
        {proposals.length === 0 ? (
          <p>No proposals yet.</p>
        ) : (
          proposals.map((proposal) => (
            <article key={proposal.id} className="market-card">
              <h3>{proposal.proposer}: {proposal.proposedOptionLabel}</h3>
              <p>Status: {proposal.status}</p>
              {proposal.note ? <p>{proposal.note}</p> : null}
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Comments</h2>
        {comments.length === 0 ? (
          <p>No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <article key={comment.id} className="market-card">
              <h3>{comment.user}</h3>
              <p>{comment.body}</p>
            </article>
          ))
        )}
      </section>

      <section className="market-list">
        <h2>Notifications</h2>
        {notifications.length === 0 ? (
          <p>No notifications yet.</p>
        ) : (
          notifications.map((notification) => (
            <article key={notification.id} className="market-card">
              <h3>{notification.title}</h3>
              <p>{notification.body}</p>
              <p>{notification.unread ? 'Unread' : 'Read'}</p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}