import { useState, type FormEvent } from 'react';
import { resetSeason, setCircleSettings, type Circle } from '../../lib';
import { useRunner } from '../../hooks';
import { ConfirmButton } from '../../ui';

export default function SettingsTab({
  circle,
  onSaved,
  onSeasonReset,
}: {
  circle: Circle;
  onSaved: () => void;
  onSeasonReset: () => void;
}) {
  const [name, setName] = useState(circle.name);
  const [startingBalance, setStartingBalance] = useState(String(circle.starting_balance));
  const [proposalBond, setProposalBond] = useState(String(circle.proposal_bond));
  const [seasonName, setSeasonName] = useState('');
  const save = useRunner();
  const reset = useRunner();

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const res = await save.run(
      () =>
        setCircleSettings(circle.id, {
          name: name.trim(),
          startingBalance: Number(startingBalance),
          proposalBond: Number(proposalBond),
        }),
      'Settings saved',
    );
    if (res.error === undefined) onSaved();
  }

  async function onReset() {
    const res = await reset.run(() => resetSeason(circle.id, seasonName.trim()), 'New season started');
    if (res.error === undefined) {
      setSeasonName('');
      onSeasonReset();
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={onSave}>
        <h2>Circle settings</h2>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <label className="field">
          <span>Starting balance</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            step={1}
            value={startingBalance}
            onChange={(e) => setStartingBalance(e.target.value)}
            required
          />
          <small className="hint">Only affects people who join after you change it.</small>
        </label>
        <label className="field">
          <span>Resolution bond</span>
          <input
            type="number"
            min={0}
            max={100_000}
            step={1}
            value={proposalBond}
            onChange={(e) => setProposalBond(e.target.value)}
            required
          />
          <small className="hint">
            What someone puts up to propose a result. Refunded if approved, forfeited if it is a
            false alarm.
          </small>
        </label>
        <button className="btn primary" disabled={save.busy}>
          {save.busy ? 'Saving...' : 'Save settings'}
        </button>
      </form>

      <div className="card stack">
        <h2>Start a new season</h2>
        <p className="hint">
          Everyone goes back to the starting balance and standings begin again. Not allowed while
          any market is unresolved or any proposal is still pending.
        </p>
        <label className="field">
          <span>Season name</span>
          <input
            value={seasonName}
            onChange={(e) => setSeasonName(e.target.value)}
            placeholder="Season 2"
          />
        </label>
        <ConfirmButton onConfirm={onReset} disabled={reset.busy || !seasonName.trim()}>
          Reset balances and start season
        </ConfirmButton>
      </div>
    </div>
  );
}
