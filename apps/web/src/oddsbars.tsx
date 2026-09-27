// The odds list: a label, its live percent, and a horizontal fill bar.
// Pulled out of OptionsPanel.tsx so a compact preview (the home screen's
// latest-market card) can show the same bars without re-implementing them.
import type { ReactNode } from 'react';
import { Pill } from './ui';
import { Percent } from './num';

export interface OddsBarRow {
  id: number;
  label: string;
  pct: number | null;
  // Extra line under the bar - OptionsPanel uses it for "$120 from 3 bets";
  // a compact preview can just leave it out.
  meta?: ReactNode;
}

export function OddsBars({
  rows,
  winningOptionId,
}: {
  rows: OddsBarRow[];
  winningOptionId?: number | null;
}) {
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id} className="option">
          <div className="spread">
            <strong>{r.label}</strong>
            <span className="row">
              {winningOptionId === r.id && <Pill tone="good">Winner</Pill>}
              {r.pct !== null && (
                <span className="muted">
                  <Percent value={r.pct} />
                </span>
              )}
            </span>
          </div>
          <div className="bar" role="presentation">
            <span style={{ width: `${r.pct ?? 0}%` }} />
          </div>
          {r.meta && <p className="muted small">{r.meta}</p>}
        </li>
      ))}
    </ul>
  );
}
