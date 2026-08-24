// Compares every interface in lib/types.ts against the real table/view
// columns. A mismatch here is invisible to tsc (reads are cast, not
// validated) and shows up as `undefined` at runtime.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const db = await PGlite.create();
await db.exec(readFileSync(HERE + 'shim.sql', 'utf8'));
await db.exec(readFileSync(HERE + '../supabase/migrations/0001_initial.sql', 'utf8'));

const MAP = {
  Circle: 'circles', Season: 'seasons', CircleMember: 'circle_members',
  Market: 'markets', MarketOption: 'market_options', Bet: 'bets',
  ResolutionProposal: 'resolution_proposals', MarketEvidence: 'market_evidence',
  LedgerEntry: 'coin_ledger', Comment: 'comments', Notification: 'notifications',
  ProposalVote: 'proposal_votes', MarketOdds: 'market_odds',
  LeaderboardRow: 'leaderboard', SeasonLeaderboardRow: 'season_leaderboard',
  ProposalVoteTally: 'proposal_vote_tally', CircleReconciliation: 'circle_reconciliation',
};

const src = readFileSync(HERE + '../apps/web/src/lib/types.ts', 'utf8');
let problems = 0;

for (const [iface, table] of Object.entries(MAP)) {
  const m = src.match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) { console.log(`\x1b[31m?? \x1b[0m ${iface}: not found in types.ts`); problems++; continue; }
  const tsFields = [...m[1].matchAll(/^\s{2}([a-z_]+)\??:/gm)].map(x => x[1]);

  const r = await db.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name=$1`, [table]);
  const dbCols = r.rows.map(x => x.column_name);

  const missingInTs = dbCols.filter(c => !tsFields.includes(c));
  const notInDb     = tsFields.filter(c => !dbCols.includes(c));

  // Nullability, base tables only. Views always report is_nullable=YES
  // because Postgres cannot infer it through an expression, so checking
  // them would be pure noise.
  const isView = ['market_odds','leaderboard','season_leaderboard',
                  'proposal_vote_tally','circle_reconciliation'].includes(table);
  const nullMismatch = [];
  if (!isView) {
    const nr = await db.query(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema='public' and table_name=$1`, [table]);
    for (const col of nr.rows) {
      if (!tsFields.includes(col.column_name)) continue;
      const decl = m[1].match(
        new RegExp(`^\\s{2}${col.column_name}\\??:\\s*([^;]+);`, 'm'));
      if (!decl) continue;
      const tsNullable = /\bnull\b/.test(decl[1]);
      const dbNullable = col.is_nullable === 'YES';
      // A NOT NULL column with a default can still be omitted on insert,
      // but it is never null when read back - so only flag the dangerous
      // direction: db can be null, TS says it cannot.
      if (dbNullable && !tsNullable) {
        nullMismatch.push(`${col.column_name} (db nullable, TS says ${decl[1].trim()})`);
      }
    }
  }

  if (nullMismatch.length) {
    console.log(`\x1b[31mNULL\x1b[0m ${iface} -> ${table}`);
    nullMismatch.forEach(x => console.log(`        ${x}`));
    problems++;
  } else if (notInDb.length) {
    console.log(`\x1b[31mBAD \x1b[0m ${iface} -> ${table}`);
    console.log(`        fields that DO NOT EXIST in the database: ${notInDb.join(', ')}`);
    problems++;
  } else if (missingInTs.length) {
    console.log(`\x1b[33mthin\x1b[0m ${iface} -> ${table}  (missing, but harmless: ${missingInTs.join(', ')})`);
  } else {
    console.log(`\x1b[32mok  \x1b[0m ${iface} -> ${table}  (${tsFields.length} fields)`);
  }
}
console.log(problems ? `\n\x1b[31m${problems} TYPE MISMATCH(ES)\x1b[0m` : '\n\x1b[32mNO TYPE MISMATCHES\x1b[0m');
process.exit(problems ? 1 : 0);
