import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { __bind, __setUser } from './fakeclient.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const HERE = fileURLToPath(new URL('.', import.meta.url));

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ' -> ' + detail : ''}`); }
}
const section = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

// unwrap a Result, failing loudly
function ok(name, res) {
  if (res.error) { check(name, false, res.error); return null; }
  check(name, true);
  return res.data;
}
function expectErr(name, res, fragment) {
  if (!res.error) return check(name, false, 'expected an error, got data');
  check(name, res.error.includes(fragment), `got "${res.error}"`);
}
// For setup steps. A silent failure here invalidates everything downstream,
// so blow up rather than let assertions fail confusingly later.
function must(what, res) {
  if (res.error) { console.error(`\n  SETUP FAILED: ${what} -> ${res.error}\n`); process.exit(2); }
  return res.data;
}

const db = await PGlite.create();
__bind(db);

section('Schema install');
try {
  await db.exec(readFileSync(HERE + 'shim.sql', 'utf8'));
  check('supabase shim loads', true);
} catch (e) { check('supabase shim loads', false, e.message); process.exit(1); }

try {
  await db.exec(readFileSync(ROOT + '/supabase/migrations/0001_initial.sql', 'utf8'));
  check('schema installs clean (self-test raises on failure, so this passing means it passed)', true);
} catch (e) { check('schema installs', false, e.message); process.exit(1); }

const counts = await db.query(`
  select
   (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') tables,
   (select count(*) from information_schema.views where table_schema='public') views,
   (select count(*) from information_schema.routines where routine_schema='public') funcs,
   (select count(*) from pg_policies where schemaname='public') policies`);
const c = counts.rows[0];
console.log(`  installed: ${c.tables} tables, ${c.views} views, ${c.funcs} functions, ${c.policies} policies`);

// ---- test users -----------------------------------------------------
const users = {};
for (const [name, meta] of [
  ['alice', { full_name: 'Alice Adams' }],
  ['bob', { name: 'Bob Brown' }],
  ['carol', {}],
]) {
  const r = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${name}@example.com`, JSON.stringify(meta)]);
  users[name] = r.rows[0].id;
}
const as = (u) => __setUser(users[u]);

// ---- import the real lib, now backed by PGlite -----------------------
const lib = await import('./lib/index.js');

// =====================================================================
section('Circles');
as('alice');
const circleId = ok('createCircle', await lib.createCircle('Test Circle'));
const circle = ok('getCircle', await lib.getCircle(circleId));
check('join_code is 6 chars', circle?.join_code?.length === 6, circle?.join_code);
check('starting_balance defaults to 1000', circle?.starting_balance === 1000);

as('bob');
const bobJoin = ok('joinCircle', await lib.joinCircle(circle.join_code));
check('join returns the same circle id', bobJoin === circleId);

as('carol');
ok('joinCircle tolerates case + whitespace',
   await lib.joinCircle('  ' + circle.join_code.toLowerCase() + '  '));

as('bob');
await lib.joinCircle(circle.join_code); // second time
const bobMem = ok('getMyMembership', await lib.getMyMembership(circleId));
check('joining twice does not grant a second balance', bobMem?.balance === 1000, `balance=${bobMem?.balance}`);
check('display_name auto-filled from OAuth metadata', bobMem?.display_name === 'Bob Brown', bobMem?.display_name);
check('bob joined as a plain member', bobMem?.role === 'member');

as('alice');
const aliceMem = ok('creator membership', await lib.getMyMembership(circleId));
check('creator is admin', aliceMem?.role === 'admin');
check('display_name prefers full_name', aliceMem?.display_name === 'Alice Adams', aliceMem?.display_name);

as('carol');
const carolMem = await lib.getMyMembership(circleId);
check('display_name falls back to email prefix', carolMem.data?.display_name === 'carol', carolMem.data?.display_name);

const members = ok('getMembers', await lib.getMembers(circleId));
check('all three members present', members?.length === 3, `got ${members?.length}`);

const myCircles = ok('getMyCircles', await lib.getMyCircles());
check('getMyCircles flattens the join into .circle',
      myCircles?.[0]?.circle?.name === 'Test Circle', JSON.stringify(myCircles?.[0]?.circle));
check('getMyCircles carries role and balance',
      myCircles?.[0]?.balance === 1000 && myCircles?.[0]?.role === 'member');
// regression: RLS exposes every member row of a circle you are in, so
// without an explicit user filter this returns one row PER MEMBER
check('getMyCircles returns one row per circle, not per member',
      myCircles?.length === 1, `got ${myCircles?.length} rows for 1 circle`);
check('getMyCircles only ever returns your own membership',
      myCircles?.every(m => m.user_id === users.carol),
      `saw user ids: ${[...new Set(myCircles?.map(m => m.user_id.slice(0,8)))].join(',')}`);

// =====================================================================
section('Markets');
as('alice');
const soon = new Date(Date.now() + 3600e3);
const mktId = ok('createMarket (binary)', await lib.createMarket({
  circleId, question: 'Will it rain tomorrow?', kind: 'binary', closesAt: soon,
}));
const mkt = ok('getMarketWithOptions', await lib.getMarketWithOptions(mktId));
check('binary market auto-creates 2 options', mkt?.options?.length === 2,
      JSON.stringify(mkt?.options?.map(o => o.label)));
check('options are Yes / No',
      mkt?.options?.map(o => o.label).sort().join(',') === 'No,Yes');
check('isBettingOpen() is true for a live market', lib.isBettingOpen(mkt) === true);
check('isSettled() is false', lib.isSettled(mkt) === false);

const ou = await lib.createMarket({
  circleId, question: 'Points scored?', kind: 'over_under', line: 8.5, closesAt: soon });
ok('createMarket (over_under with .5 line)', ou);
expectErr('over_under rejects a whole-number line',
  await lib.createMarket({ circleId, question: 'Bad line?', kind: 'over_under', line: 8, closesAt: soon }),
  'half number');
expectErr('multi rejects fewer than 2 options',
  await lib.createMarket({ circleId, question: 'Who?', kind: 'multi', options: ['Solo'], closesAt: soon }),
  'at least 2');
expectErr('multi rejects duplicate options',
  await lib.createMarket({ circleId, question: 'Who?', kind: 'multi', options: ['Zach', ' zach '], closesAt: soon }),
  'Duplicate option');
const multiId = ok('createMarket (multi)', await lib.createMarket({
  circleId, question: 'Who wins?', kind: 'multi', options: ['Zach', 'York', 'Nobody'], closesAt: soon }));
const multiOpts = ok('getOptions', await lib.getOptions(multiId));
check('multi keeps all 3 options', multiOpts?.length === 3);

const openId = await lib.createMarket({
  circleId, question: 'Name the mystery guest', kind: 'open', closesAt: soon });
as('bob');
ok('submitOption on an open market', await lib.submitOption(openId.data, 'A wildcard'));
// dedup normalises case and surrounding whitespace (not internal spacing)
expectErr('submitOption rejects duplicates',
  await lib.submitOption(openId.data, '  a wildcard  '), 'already exists');
expectErr('submitOption refused on a fixed-option market',
  await lib.submitOption(mktId, 'Maybe'), 'fixed options');

// =====================================================================
section('Betting');
const yes = mkt.options.find(o => o.label === 'Yes');
const no  = mkt.options.find(o => o.label === 'No');

as('bob');
const bobBal = ok('placeBet', await lib.placeBet(mktId, yes.id, 100));
check('placeBet returns the new balance', bobBal === 900, `got ${bobBal}`);
as('carol');
const carolBal = ok('placeBet (carol)', await lib.placeBet(mktId, no.id, 200));
check('carol balance after 200 stake', carolBal === 800, `got ${carolBal}`);

const odds = ok('getOdds', await lib.getOdds(mktId));
const yesOdds = odds.find(o => o.option_id === yes.id);
const noOdds  = odds.find(o => o.option_id === no.id);
check('odds pool reflects stakes', yesOdds?.pool === 100 && noOdds?.pool === 200,
      `yes=${yesOdds?.pool} no=${noOdds?.pool}`);
check('odds pct computed', Number(yesOdds?.pct) === 33.3 && Number(noOdds?.pct) === 66.7,
      `yes=${yesOdds?.pct} no=${noOdds?.pct}`);
check('projectedPayout matches the pool split',
      lib.projectedPayout(100, 100, 300) === 300);

as('bob');
expectErr('placeBet blocks overspending', await lib.placeBet(mktId, yes.id, 99999), 'Not enough dollars');
expectErr('placeBet rejects a negative stake', await lib.placeBet(mktId, yes.id, -50), 'must be positive');
expectErr('placeBet rejects an option from another market',
  await lib.placeBet(mktId, multiOpts[0].id, 10), 'does not belong');

const myBets = ok('getMyBets', await lib.getMyBets({ circleId }));
check('getMyBets flattens market + option',
      myBets?.[0]?.market?.question === 'Will it rain tomorrow?' && myBets?.[0]?.option?.label === 'Yes',
      JSON.stringify({ m: myBets?.[0]?.market?.question, o: myBets?.[0]?.option?.label }));
const marketBets = ok('getMarketBets', await lib.getMarketBets(mktId));
check('getMarketBets sees both bets', marketBets?.length === 2, `got ${marketBets?.length}`);
const openBets = ok('getOpenBets', await lib.getOpenBets(circleId));
check('getOpenBets finds pending stakes', openBets?.length === 2, `got ${openBets?.length}`);

// a market whose betting window has already shut
as('alice');
const pastId = (await lib.createMarket({
  circleId, question: 'Did the game finish?', kind: 'binary',
  opensAt: new Date(Date.now() - 7200e3), closesAt: new Date(Date.now() - 3600e3),
})).data;
const pastMkt = (await lib.getMarketWithOptions(pastId)).data;
check('isBettingOpen() false once closes_at has passed', lib.isBettingOpen(pastMkt) === false);
as('bob');
expectErr('placeBet refused after close',
  await lib.placeBet(pastId, pastMkt.options[0].id, 10), 'Betting has closed');

// =====================================================================
section('Resolution');
check('canProposeResolution() false while the event is unfinished',
      lib.canProposeResolution(mkt) === false);
check('canProposeResolution() true once closed', lib.canProposeResolution(pastMkt) === true);

as('bob');
expectErr('propose_resolution blocked before the event ends',
  await lib.proposeResolution(mktId, yes.id, 'too early'), 'has not finished yet');

// A market to actually settle. It has to be OPEN to take bets, so bet
// first and then move its clock backwards - the only way to reach the
// post-event state without waiting an hour.
as('alice');
const resId = must('create market to resolve', await lib.createMarket({
  circleId, question: 'Did the game finish?', kind: 'binary', closesAt: soon }));
const resOpts = must('resolve-market options', await lib.getOptions(resId));
const resYes = resOpts.find(o => o.label === 'Yes');
const resNo  = resOpts.find(o => o.label === 'No');

as('bob');   must('bob stakes 300 on Yes', await lib.placeBet(resId, resYes.id, 300));
as('carol'); must('carol stakes 100 on No', await lib.placeBet(resId, resNo.id, 100));

// opens_at has to move too, or the closes_at > opens_at constraint fires
await db.exec(`update public.markets
               set opens_at     = now() - interval '3 hours',
                   closes_at    = now() - interval '1 hour',
                   event_end_at = now() - interval '1 hour'
               where id = ${resId}`);

as('bob');
const balBefore = (await lib.getMyMembership(circleId)).data.balance;
const propId = ok('proposeResolution', await lib.proposeResolution(resId, resYes.id, 'It finished'));
const balAfterBond = (await lib.getMyMembership(circleId)).data.balance;
check('proposing deducts the 50-dollar bond', balBefore - balAfterBond === 50,
      `${balBefore} -> ${balAfterBond}`);

const props = ok('getProposals', await lib.getProposals(resId));
check('proposal is pending', props?.[0]?.status === 'pending');
check('bond recorded on the proposal', props?.[0]?.bond === 50);
check('getProposals embeds the proposed option',
      props?.[0]?.option?.label === 'Yes', JSON.stringify(props?.[0]?.option));

as('carol');
ok('voteOnProposal', await lib.voteOnProposal(propId, 'approve'));
const myVote = ok('getMyVote', await lib.getMyVote(propId));
check('getMyVote reads it back', myVote?.vote === 'approve');
ok('voteOnProposal can be changed', await lib.voteOnProposal(propId, 'disapprove'));
const tally = ok('getVoteTally', await lib.getVoteTally(propId));
check('tally counts the changed vote',
      Number(tally?.disapprove_count) === 1 && Number(tally?.approve_count) === 0,
      JSON.stringify(tally));
ok('clearProposalVote', await lib.clearProposalVote(propId));

as('bob');
expectErr('non-admin cannot review a proposal',
  await lib.reviewProposal(propId, 'approve'), 'Only circle admins');

as('alice');
ok('reviewProposal(approve)', await lib.reviewProposal(propId, 'approve'));
const settled = (await lib.getMarket(resId)).data;
check('market is now resolved', settled?.status === 'resolved', settled?.status);
check('winning option recorded', settled?.winning_option_id === resYes.id);
check('isSettled() true after resolution', lib.isSettled(settled) === true);

as('bob');
const bobFinal = (await lib.getMyMembership(circleId)).data.balance;
// bob staked 300 on Yes and was the only Yes backer; pot was 400. bond of 50 refunded.
check('winner paid the whole pot', bobFinal === balAfterBond + 400 + 50,
      `expected ${balAfterBond + 450}, got ${bobFinal}`);

const bobHistory = ok('getMyBets(status: won)', await lib.getMyBets({ circleId, status: 'won' }));
check('winning bet shows a payout', bobHistory?.[0]?.payout === 400, `payout=${bobHistory?.[0]?.payout}`);

// =====================================================================
section('Leaderboard & audit');
const board = ok('getLeaderboard', await lib.getLeaderboard(circleId));
check('leaderboard has a row per member', board?.length === 3, `got ${board?.length}`);
check('leaderboard sorted by net_profit desc',
      board[0].net_profit >= board[1].net_profit && board[1].net_profit >= board[2].net_profit,
      board?.map(r => `${r.display_name}:${r.net_profit}`).join(' '));
check('bob leads after winning', board[0].display_name === 'Bob Brown', board[0].display_name);
check('bob shows 1 settled win', board[0].bets_won === 1 && board[0].bets_settled === 1);

const recon = await db.query(`select * from public.circle_reconciliation where circle_id = $1`, [circleId]);
check('ledger reconciles — drift is 0', Number(recon.rows[0].drift) === 0,
      `drift=${recon.rows[0].drift}`);

const ledger = ok('getLedger', await lib.getLedger(circleId));
check('ledger recorded every movement', ledger?.length > 0, `${ledger?.length} entries`);
const reasons = new Set(ledger.map(l => l.reason));
check('ledger reasons look right',
      reasons.has('initial_grant') && reasons.has('bet') && reasons.has('payout')
      && reasons.has('proposal_bond') && reasons.has('bond_refund'),
      [...reasons].join(','));

const seasons = ok('getSeasons', await lib.getSeasons(circleId));
check('circle has an active season', seasons?.some(s => s.is_active));
if (seasons?.length) {
  const sb = ok('getSeasonLeaderboard', await lib.getSeasonLeaderboard(seasons[0].id));
  check('season leaderboard returns rows', sb?.length === 3, `got ${sb?.length}`);
}

// =====================================================================
section('Admin');
as('bob');
expectErr('non-admin cannot adjust coins',
  await lib.adminAdjustCoins(circleId, users.carol, 500, 'nope'), 'Only circle admins');
expectErr('non-admin cannot change roles',
  await lib.setMemberRole(circleId, users.carol, 'admin'), 'Only circle admins');

as('alice');
const carolBefore = (await lib.getMembers(circleId)).data.find(m => m.user_id === users.carol).balance;
const newBal = ok('adminAdjustCoins', await lib.adminAdjustCoins(circleId, users.carol, 500, 'bonus'));
check('adminAdjustCoins returns the new balance', newBal === carolBefore + 500,
      `${carolBefore} + 500 != ${newBal}`);
expectErr('adminAdjustCoins refuses to go below zero',
  await lib.adminAdjustCoins(circleId, users.carol, -99999, 'drain'), 'below zero');
ok('setMemberRole promotes', await lib.setMemberRole(circleId, users.bob, 'admin'));
expectErr('the creator cannot be demoted',
  await lib.setMemberRole(circleId, users.alice, 'member'), 'cannot be demoted');
ok('setCircleSettings', await lib.setCircleSettings(circleId, { name: 'Renamed Circle', proposalBond: 75 }));
const renamed = (await lib.getCircle(circleId)).data;
check('settings applied', renamed?.name === 'Renamed Circle' && renamed?.proposal_bond === 75,
      `${renamed?.name} / ${renamed?.proposal_bond}`);
check('omitted setting left alone', renamed?.starting_balance === 1000);
ok('renameMember', await lib.renameMember(circleId, 'Big Al'));
check('rename applied', (await lib.getMyMembership(circleId)).data.display_name === 'Big Al');

// =====================================================================
section('Comments & notifications');
as('bob');
const comment = ok('addComment', await lib.addComment(circleId, 'easy money'));
const comments = ok('getComments', await lib.getComments(circleId));
check('comment is readable', comments?.[0]?.body === 'easy money');
ok('deleteComment', await lib.deleteComment(comment.id));
check('comment removed', (await lib.getComments(circleId)).data.length === 0);

const notes = ok('getNotifications', await lib.getNotifications());
check('getNotifications returns an array', Array.isArray(notes), typeof notes);
ok('markAllNotificationsRead', await lib.markAllNotificationsRead());

// =====================================================================
section('Void & privacy');
as('alice');
const voidId = (await lib.createMarket({
  circleId, question: 'Cancel me', kind: 'binary', closesAt: soon })).data;
ok('cancelMarket with no bets', await lib.cancelMarket(voidId));
check('cancelled market is gone', (await lib.getMarket(voidId)).error !== undefined);

const vId = (await lib.createMarket({
  circleId, question: 'Void me', kind: 'binary', closesAt: soon })).data;
const vOpts = (await lib.getOptions(vId)).data;
as('carol');
const carolPre = (await lib.getMyMembership(circleId)).data.balance;
await lib.placeBet(vId, vOpts[0].id, 150);
as('alice');
expectErr('cancelMarket refused once bets exist', await lib.cancelMarket(vId), 'void_market');
ok('voidMarket', await lib.voidMarket(vId, 'bad question'));
as('carol');
check('voided market refunds the stake',
      (await lib.getMyMembership(circleId)).data.balance === carolPre,
      `${carolPre} -> ${(await lib.getMyMembership(circleId)).data.balance}`);

// an outsider must see nothing
const r = await db.query(
  `insert into auth.users (email) values ('dave@example.com') returning id`);
users.dave = r.rows[0].id;
__setUser(users.dave);
const outsiderCircles = await lib.getMyCircles();
check('a non-member sees no circles', outsiderCircles.data?.length === 0,
      `saw ${outsiderCircles.data?.length}`);
const outsiderMarkets = await lib.getMarkets(circleId);
check('RLS hides another circle\'s markets', outsiderMarkets.data?.length === 0,
      `saw ${outsiderMarkets.data?.length}`);
expectErr('a non-member cannot bet', await lib.placeBet(mktId, yes.id, 10), 'Not a member');

// =====================================================================
section('Editing markets');
as('alice');
const editId = must('market to edit', await lib.createMarket({
  circleId, question: 'Original question', kind: 'binary', closesAt: soon }));
ok('updateMarket before any bets', await lib.updateMarket(editId, {
  question: 'Edited question', imageUrl: 'https://example.com/a.png' }));
const edited = (await lib.getMarket(editId)).data;
check('edit applied', edited?.question === 'Edited question', edited?.question);
check('omitted field untouched', edited?.image_url === 'https://example.com/a.png');

as('carol');
expectErr('a non-creator non-admin cannot edit',
  await lib.updateMarket(editId, { question: 'Hijacked' }), 'Only the market creator');

// once a bet lands, the question freezes but the image does not
const editOpts = (await lib.getOptions(editId)).data;
must('bet to freeze the market', await lib.placeBet(editId, editOpts[0].id, 25));
as('alice');
expectErr('question frozen once bets exist',
  await lib.updateMarket(editId, { question: 'Too late' }), 'Only the image');
ok('image still editable after bets',
  await lib.updateMarket(editId, { imageUrl: 'https://example.com/b.png' }));

section('Direct resolve, voidBet, leave, season reset');
// resolveMarket skips the proposal flow entirely
as('alice');
const drId = must('market to resolve directly', await lib.createMarket({
  circleId, question: 'Resolve me directly', kind: 'binary', closesAt: soon }));
const drOpts = must('options', await lib.getOptions(drId));
as('bob');   must('bob stakes', await lib.placeBet(drId, drOpts[0].id, 50));
as('carol'); must('carol stakes', await lib.placeBet(drId, drOpts[1].id, 50));
as('carol');
expectErr('non-admin cannot resolve',
  await lib.resolveMarket(drId, drOpts[0].id), 'Only circle admins');
as('alice');
ok('resolveMarket', await lib.resolveMarket(drId, drOpts[0].id));
check('directly resolved market is settled',
      (await lib.getMarket(drId)).data?.status === 'resolved');

// voidBet refunds one person without touching the rest of the market
const vbId = must('market for voidBet', await lib.createMarket({
  circleId, question: 'Void one bet', kind: 'binary', closesAt: soon }));
const vbOpts = must('options', await lib.getOptions(vbId));
as('carol');
const preVoid = (await lib.getMyMembership(circleId)).data.balance;
must('carol stakes', await lib.placeBet(vbId, vbOpts[0].id, 60));
const myOnMarket = ok('getMyBetsOnMarket', await lib.getMyBetsOnMarket(vbId));
check('getMyBetsOnMarket finds it', myOnMarket?.length === 1, `got ${myOnMarket?.length}`);
// carol, not bob - bob was promoted to admin back in the Admin section
expectErr('non-admin cannot void a bet',
  await lib.voidBet(myOnMarket[0].id, 'nope'), 'Only circle admins');
as('alice');
ok('voidBet', await lib.voidBet(myOnMarket[0].id, 'placed by mistake'));
as('carol');
check('voidBet refunds the stake',
      (await lib.getMyMembership(circleId)).data.balance === preVoid,
      `${preVoid} -> ${(await lib.getMyMembership(circleId)).data.balance}`);
check('voided bet no longer counts as open',
      (await lib.getMyBetsOnMarket(vbId)).data.length === 0);

// leaveCircle is refused while money is still in play
as('carol');
expectErr('cannot leave with open bets', await lib.leaveCircle(circleId), 'open bets');
as('alice');
expectErr('the creator cannot leave', await lib.leaveCircle(circleId), 'creator cannot leave');

// a fresh member with no history can leave cleanly
__setUser(users.dave);
must('dave joins', await lib.joinCircle(circle.join_code));
check('dave is in', (await lib.getMyMembership(circleId)).data !== null);
ok('leaveCircle', await lib.leaveCircle(circleId));
check('dave is out', (await lib.getMyCircles()).data.length === 0);

// removeMember: an admin kicking someone else out
__setUser(users.dave);
must('dave rejoins', await lib.joinCircle(circle.join_code));
as('carol');
expectErr('non-admin cannot remove a member',
  await lib.removeMember(circleId, users.dave), 'Only circle admins');
as('alice');
expectErr('removeMember refuses self-removal',
  await lib.removeMember(circleId, users.alice), 'leave_circle');
ok('removeMember', await lib.removeMember(circleId, users.dave));
check('member list back to three', (await lib.getMembers(circleId)).data.length === 3,
      `got ${(await lib.getMembers(circleId)).data.length}`);

// resetSeason is blocked while anything is unresolved
as('alice');
expectErr('resetSeason blocked while markets are open',
  await lib.resetSeason(circleId, 'Season 2'), 'Resolve or void');

section('Remaining reads');
as('bob');
const props2 = (await lib.getProposals(resId)).data;
const votes = ok('getProposalVotes', await lib.getProposalVotes(props2[0].id));
check('getProposalVotes returns an array', Array.isArray(votes));
const ev = ok('getEvidence', await lib.getEvidence(mktId));
check('getEvidence returns an array', Array.isArray(ev), typeof ev);
check('canSubmitOption false for a fixed-option market',
      lib.canSubmitOption(mkt) === false);
check('canSubmitOption true for a live open market',
      lib.canSubmitOption((await lib.getMarket(openId.data)).data) === true);

// deleting what is not yours must report failure, not silent success
const c2 = must('bob comments', await lib.addComment(circleId, 'mine'));
as('carol');
expectErr('deleting another user\'s comment reports failure',
  await lib.deleteComment(c2.id), 'not yours');
check('the comment survived', (await lib.getComments(circleId)).data.length === 1);
as('bob');
ok('deleting your own comment works', await lib.deleteComment(c2.id));

const notes2 = (await lib.getNotifications()).data;
if (notes2.length) {
  ok('markNotificationRead', await lib.markNotificationRead(notes2[0].id));
} else {
  check('markNotificationRead (no notifications to mark)', true);
}

section('Option branches');
as('alice');
// every opts.* path below was previously unexercised; .in() in particular is
// its own SQL path and had never run
const resolvedOnly = ok('getMarkets({status})',
  await lib.getMarkets(circleId, { status: 'resolved' }));
check('status filter returns only that status',
      resolvedOnly.length > 0 && resolvedOnly.every(m => m.status === 'resolved'),
      `got ${resolvedOnly.map(m => m.status).join(',')}`);

const twoStatuses = ok('getMarkets({status: [...]}) - the .in() path',
  await lib.getMarkets(circleId, { status: ['resolved', 'voided'] }));
check('array status filter accepts both',
      twoStatuses.every(m => m.status === 'resolved' || m.status === 'voided'),
      `got ${[...new Set(twoStatuses.map(m => m.status))].join(',')}`);
check('array status returns at least as many as the single filter',
      twoStatuses.length >= resolvedOnly.length,
      `${twoStatuses.length} vs ${resolvedOnly.length}`);

const limited = ok('getMarkets({limit})', await lib.getMarkets(circleId, { limit: 2 }));
check('limit is applied', limited.length <= 2, `got ${limited.length}`);

const carolLedger = ok('getLedger({userId})',
  await lib.getLedger(circleId, { userId: users.carol }));
check('ledger userId filter returns only that user',
      carolLedger.length > 0 && carolLedger.every(e => e.user_id === users.carol),
      `${carolLedger.length} rows, ${new Set(carolLedger.map(e => e.user_id)).size} distinct users`);
const ledger1 = ok('getLedger({limit})', await lib.getLedger(circleId, { limit: 1 }));
check('ledger limit is applied', ledger1.length === 1, `got ${ledger1.length}`);

const pending = ok('getProposals({status})',
  await lib.getProposals(resId, { status: 'approved' }));
check('proposal status filter works',
      pending.every(p => p.status === 'approved'),
      `got ${[...new Set(pending.map(p => p.status))].join(',')}`);

as('bob');
const unread = ok('getNotifications({unreadOnly})',
  await lib.getNotifications({ unreadOnly: true }));
check('unreadOnly returns only unread rows',
      unread.every(n => n.read_at === null), `${unread.length} rows`);
const oneNote = ok('getNotifications({limit})', await lib.getNotifications({ limit: 1 }));
check('notification limit is applied', oneNote.length <= 1);

section('User-typed limits must read as sentences');
// Length/range limits live as Postgres CHECK constraints, not as guards in
// the SQL functions, so they arrive as
//   new row for relation "markets" violates check constraint "..."
// Every field below is one a user types into.
as('alice');
const RAW = /violates check constraint|violates not-null|value too long|relation "/;
const long = (n) => 'x'.repeat(n);
for (const [label, res] of [
  ['createCircle empty',        await lib.createCircle('')],
  ['createCircle too long',     await lib.createCircle(long(61))],
  ['createMarket short question', await lib.createMarket({
      circleId, question: 'Q?', kind: 'binary', closesAt: soon })],
  ['createMarket long question', await lib.createMarket({
      circleId, question: long(301), kind: 'binary', closesAt: soon })],
  ['submitOption too long',     await lib.submitOption(openId.data, long(101))],
  ['addComment too long',       await lib.addComment(circleId, long(1001))],
  ['addComment empty',          await lib.addComment(circleId, '')],
  ['setCircleSettings balance 0',  await lib.setCircleSettings(circleId, { startingBalance: 0 })],
  ['setCircleSettings bond -1',    await lib.setCircleSettings(circleId, { proposalBond: -1 })],
]) {
  check(`${label} reads as a sentence`,
        !!res.error && !RAW.test(res.error), `got "${res.error}"`);
}

// Guard against a new CHECK constraint being added to the schema without a
// matching message. This fails loudly rather than waiting for a user to hit it.
const known = (await db.query(`
  select con.conname from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where con.contype = 'c' and n.nspname = 'public'`)).rows.map(r => r.conname);
const libSrc = readFileSync(HERE + '../apps/web/src/lib/supabase.ts', 'utf8');
// enum-style constraints can only be tripped by a bug in this folder, never
// by something a user types, so they do not need a friendly message
const enumLike = /_(status|role|kind|vote|reason|media_type)_?(check|ck)$/;
// Values the database computes for itself. A user has no field that reaches
// these, so hitting one would mean a server bug, not bad input:
//   bets_payout_check              payout is written only by resolve_market
//   resolution_proposals_bond_check bond is copied from circles.proposal_bond,
//                                   which is already constrained >= 0
//   coin_ledger_amount_check       admin_adjust_coins rejects zero first
const serverOnly = [
  'bets_payout_check',
  'resolution_proposals_bond_check',
  'coin_ledger_amount_check',
];
const unmapped = known.filter(c =>
  !enumLike.test(c) && !serverOnly.includes(c) && !libSrc.includes(c));
check('every user-reachable CHECK constraint has a message',
      unmapped.length === 0,
      `unmapped: ${unmapped.join(', ')} - add to CONSTRAINT_MESSAGES in supabase.ts`);

// and whatever slips through still must not reach a user as raw Postgres
check('an unmapped constraint still falls back to a sentence',
      (await lib.read(Promise.resolve({ data: null, status: 400, error: { message:
        'new row for relation "bets" violates check constraint "bets_payout_check"' } })))
        .error === "That value isn't valid. Check the form and try again.");

section('Error surfaces and bad input');
as('bob');
// a missing row, or one RLS is hiding, must not leak PostgREST's own wording
expectErr('getMarket on a missing row',    await lib.getMarket(999999),    'Market not found');
expectErr('getCircle on a missing row',    await lib.getCircle(999999),    'Circle not found');
expectErr('getMarketWithOptions missing',  await lib.getMarketWithOptions(999999), 'Market not found');
expectErr('getVoteTally on a missing row', await lib.getVoteTally(999999),  'Proposal not found');
// list reads return empty rather than erroring - different, and deliberate
check('getMembers on a hidden circle returns []',
      (await lib.getMembers(999999)).data?.length === 0);
check('getMyMembership elsewhere returns null',
      (await lib.getMyMembership(999999)).data === null);

// an invalid Date must come back as { error }, never throw. toISOString()
// raises RangeError, and a half-filled date field produces exactly that.
const bad = new Date('not a date');
expectErr('createMarket rejects an invalid closesAt',
  await lib.createMarket({ circleId, question: 'Bad date', kind: 'binary', closesAt: bad }),
  'closesAt is not a valid date');
expectErr('createMarket rejects an invalid eventEndAt',
  await lib.createMarket({ circleId, question: 'Bad date', kind: 'binary',
                           closesAt: soon, eventEndAt: bad }),
  'eventEndAt is not a valid date');
expectErr('updateMarket rejects an invalid closesAt',
  await lib.updateMarket(mktId, { closesAt: bad }), 'closesAt is not a valid date');
expectErr('createMarket rejects an unparseable date string',
  await lib.createMarket({ circleId, question: 'Bad date', kind: 'binary', closesAt: 'yesterday' }),
  'closesAt is not a valid date');
// a valid ISO string must still work
ok('createMarket accepts an ISO string',
   await lib.createMarket({ circleId, question: 'ISO string date', kind: 'binary',
                            closesAt: soon.toISOString() }));

// a fetch that never reached the server (offline phone, DNS failure) arrives
// as status 0 with raw JS text - it must not reach the user that way
check('read() translates a network failure',
      (await lib.read(Promise.resolve({
        data: null, status: 0,
        error: { message: 'TypeError: Failed to fetch' },
      }))).error === 'Could not reach the server. Check your connection and try again.',
      (await lib.read(Promise.resolve({
        data: null, status: 0, error: { message: 'TypeError: Failed to fetch' },
      }))).error);
check('read() leaves a real server error alone',
      (await lib.read(Promise.resolve({
        data: null, status: 400, error: { message: 'Not enough dollars' },
      }))).error === 'Not enough dollars');
check('read() passes data through untouched',
      (await lib.read(Promise.resolve({ data: [1, 2], status: 200, error: null })))
        .data.length === 2);

// uploadEvidence derives the circle from the market rather than trusting the
// caller, so a market you cannot see is a clean sentence, not a storage error
expectErr('uploadEvidence on a market RLS hides',
  await lib.uploadEvidence(new File(['x'], 'p.jpg', { type: 'image/jpeg' }), { marketId: 999999 }),
  'Market not found');

// evidence is photos only, and only JPEG: a PDF, or a PNG that skipped preparePhoto(),
// is refused with a sentence before anything reaches storage
const pdf = new File(['x'], 'receipt.pdf', { type: 'application/pdf' });
expectErr('uploadEvidence refuses a PDF',
  await lib.uploadEvidence(pdf, { marketId: mktId }),
  'must be a photo');
expectErr('uploadEvidence refuses a PNG that was not prepared',
  await lib.uploadEvidence(new File(['x'], 'p.png', { type: 'image/png' }), { marketId: mktId }),
  'must be a photo');

// and must not throw when crypto.randomUUID is unavailable, which is the
// case over plain http - i.e. testing the PWA on a phone via a LAN address
const upMkt = must('a market with room for photos', await lib.createMarket({
  circleId, question: 'Upload test market', kind: 'binary', closesAt: new Date(Date.now() + 86_400_000) }));
const realUUID = crypto.randomUUID;
delete crypto.randomUUID;
try {
  const jpg = new File(['x'], 'proof.jpg', { type: 'image/jpeg' });
  const r = await lib.uploadEvidence(jpg, { marketId: upMkt });
  check('uploadEvidence survives no crypto.randomUUID',
        r.error === 'storage not available in sandbox',
        `got "${r.error}" (should have reached the storage call)`);
} catch (e) {
  check('uploadEvidence survives no crypto.randomUUID', false, `threw ${e.message}`);
} finally {
  crypto.randomUUID = realUUID;
}


// =====================================================================
section('v5 regressions');
//
// One block per bug fixed in schema v5. Each asserts the OUTCOME a player
// would see, not the mechanism, so a future refactor that reintroduces the bug
// by another route still trips these.
// =====================================================================
const DAY = 86400e3;
const later = (ms) => new Date(Date.now() + ms);

// dave was removed from the circle by the removeMember test above; several
// scenarios here need a fourth player.
as('dave');
must('dave rejoins for the v5 scenarios', await lib.joinCircle(circle.join_code));

// ---- v5.1 event_end_at must not precede closes_at -------------------
// The unwinnable market: created "already over", so the first proposal drew the
// quarantine line before betting opened and resolution refunded the whole pot.
as('alice');
expectErr('createMarket refuses an event that ends before betting closes',
  await lib.createMarket({
    circleId, question: 'Event already over at creation', kind: 'binary',
    opensAt: later(DAY), closesAt: later(2 * DAY), eventEndAt: new Date(Date.now() - DAY),
  }),
  'The event cannot end before betting closes');

expectErr('createMarket refuses an event that starts after it ends',
  await lib.createMarket({
    circleId, question: 'Event starts after it ends', kind: 'binary',
    closesAt: later(DAY), eventStartAt: later(3 * DAY), eventEndAt: later(2 * DAY),
  }),
  'The event cannot start after it ends');

check('createMarket still accepts eventEndAt == closesAt',
  !(await lib.createMarket({
    circleId, question: 'Event ends exactly when betting closes', kind: 'binary',
    closesAt: later(DAY), eventEndAt: later(DAY),
  })).error);

// update_market was the same door left open
const v5edit = must('market for the update_market check', await lib.createMarket({
  circleId, question: 'Editable timing', kind: 'binary', closesAt: later(2 * DAY),
}));
expectErr('updateMarket refuses to back-date eventEndAt under closesAt',
  await lib.updateMarket(v5edit, { eventEndAt: new Date(Date.now() - DAY) }),
  'The event cannot end before betting closes');
check('updateMarket left the market alone after refusing',
  (await lib.getMarket(v5edit)).data.event_end_at === null);

// ---- v5.2 reject_close on a market that has not opened yet ----------
// least(closes_at, now()) used to pull closes_at under opens_at and abort.
as('alice');
const v5sched = must('scheduled market', await lib.createMarket({
  circleId, question: 'Scheduled, proposed early', kind: 'binary',
  opensAt: later(DAY), closesAt: later(2 * DAY),
}));
// reach the proposal gate the only way a scheduled market can: an event_end_at
// in the past. create_market now refuses that, so plant it directly - the point
// of this test is review_proposal's arithmetic, not how the row got there.
await db.query(`update public.markets set event_end_at = now() - interval '1 hour' where id = $1`, [v5sched]);
const v5schedOpt = (await lib.getOptions(v5sched)).data[0].id;
as('bob');
const v5prop = must('early proposal', await lib.proposeResolution(v5sched, v5schedOpt));
as('alice');
check('reject_close works on a market that has not opened yet',
  !(await lib.reviewProposal(v5prop, 'reject_close')).error);
const v5schedRow = (await db.query(
  `select status, closes_at > opens_at as window_valid from public.markets where id = $1`, [v5sched])).rows[0];
check('reject_close left a valid betting window', v5schedRow.window_valid === true);
check('reject_close closed the market', v5schedRow.status === 'closed');
as('carol');
expectErr('and betting really is shut', await lib.placeBet(v5sched, v5schedOpt, 10), 'closed');

// reject_close must leave a window that later derivations still read as closed.
// Flooring closes_at at opens_at satisfied the constraint but left a CLOSED
// market whose window was in the FUTURE - and update_market() recomputes status
// from those timestamps, so the next image edit handed it back to the cron.
check('reject_close pulled the whole window into the past',
  (await db.query(
    `select opens_at < now() and closes_at <= now() as past from public.markets where id=$1`,
    [v5sched])).rows[0].past === true);
as('alice');
check('an unrelated edit does not resurrect a closed market',
  !(await lib.updateMarket(v5sched, { imageUrl: 'https://example.com/x.png' })).error);
check('...and it is still closed afterwards',
  (await lib.getMarket(v5sched)).data.status === 'closed');
as('carol');
expectErr('...and still unbettable', await lib.placeBet(v5sched, v5schedOpt, 10), 'closed');

// The ordering check must not shout over the more specific frozen-field error,
// and must not fire at all when the caller is not touching the event window.
as('alice');
const v5froz = must('market with bets', await lib.createMarket({
  circleId, question: 'Frozen fields keep their own error', kind: 'binary',
  closesAt: later(DAY), eventEndAt: later(DAY),
}));
const v5frozOpt = (await lib.getOptions(v5froz)).data[0].id;
as('dave'); must('a bet exists', await lib.placeBet(v5froz, v5frozOpt, 25));
as('alice');
expectErr('moving closesAt on a betted market still reports the frozen-field error',
  await lib.updateMarket(v5froz, { closesAt: later(5 * DAY) }),
  'Only the image can be changed now');
check('editing only the image on a betted market still works',
  !(await lib.updateMarket(v5froz, { imageUrl: 'https://example.com/y.png' })).error);

// ---- v5.3 reject_reopen must clear the quarantine line --------------
// A bet placed after an admin reopens the market has to be able to WIN.
as('alice');
const v5re = must('market for reopen', await lib.createMarket({
  circleId, question: 'False alarm then real bets', kind: 'binary', closesAt: later(2 * DAY),
}));
const v5reOpts = (await lib.getOptions(v5re)).data;
as('bob');   must('early yes', await lib.placeBet(v5re, v5reOpts[0].id, 100));
as('carol'); must('early no',  await lib.placeBet(v5re, v5reOpts[1].id, 100));
// let a proposal through without tripping the new create_market rule
await db.query(`update public.markets set event_end_at = now() - interval '1 minute' where id = $1`, [v5re]);
as('bob');
const v5falseAlarm = must('false alarm', await lib.proposeResolution(v5re, v5reOpts[0].id, 'premature'));
as('alice');
check('reject_reopen succeeds', !(await lib.reviewProposal(v5falseAlarm, 'reject_reopen')).error);
check('reject_reopen cleared the quarantine line',
  (await lib.getMarket(v5re)).data.review_started_at === null);
check('reject_reopen reset was_late on the bets it un-quarantined',
  (await db.query(`select count(*)::int n from public.bets where market_id=$1 and was_late`, [v5re])).rows[0].n === 0);

as('dave');
must('dave accepts the reopened invitation', await lib.placeBet(v5re, v5reOpts[0].id, 100));
as('alice');
must('resolve the reopened market', await lib.resolveMarket(v5re, v5reOpts[0].id));
const v5reBets = (await db.query(
  `select user_id, status, payout from public.bets where market_id=$1`, [v5re])).rows;
const daveBet = v5reBets.find(r => r.user_id === users.dave);
check('a bet placed after the reopen can WIN', daveBet.status === 'won', `status=${daveBet.status}`);
check('and is paid more than its stake', daveBet.payout > 100, `payout=${daveBet.payout}`);
check('nobody on the reopened market was voided',
  v5reBets.every(r => r.status !== 'void'));

// the v2 concern the fix has to preserve: with ANOTHER proposal still pending,
// the line must survive, because bets really are snipe-suspect
as('alice');
const v5two = must('market for two proposals', await lib.createMarket({
  circleId, question: 'Two live proposals', kind: 'binary', closesAt: later(2 * DAY),
}));
const v5twoOpts = (await lib.getOptions(v5two)).data;
await db.query(`update public.markets set event_end_at = now() - interval '1 minute' where id = $1`, [v5two]);
as('bob');   const pA = must('proposal A', await lib.proposeResolution(v5two, v5twoOpts[0].id));
as('carol'); must('proposal B', await lib.proposeResolution(v5two, v5twoOpts[1].id));
as('alice');
must('reject one of two', await lib.reviewProposal(pA, 'reject_reopen'));
check('quarantine line SURVIVES while another proposal is pending',
  (await lib.getMarket(v5two)).data.review_started_at !== null);

// ---- v5.4 projectedPayout must equal what the market pays -----------
as('alice');
const v5pay = must('market for payout maths', await lib.createMarket({
  circleId, question: 'Payout projection is exact', kind: 'binary', closesAt: later(DAY),
}));
const v5payOpts = (await lib.getOptions(v5pay)).data;
as('bob');   must('bob 7',   await lib.placeBet(v5pay, v5payOpts[0].id, 7));
as('carol'); must('carol 3', await lib.placeBet(v5pay, v5payOpts[0].id, 3));
as('dave');  must('dave 80', await lib.placeBet(v5pay, v5payOpts[1].id, 80));
const v5odds = (await lib.getOdds(v5pay)).data;
const winPool = v5odds.find(o => o.option_id === v5payOpts[0].id).pool;
const potTotal = v5odds.reduce((s, o) => s + o.pool, 0);
const projected = lib.projectedPayout(7, winPool, potTotal);
as('alice');
must('resolve the payout market', await lib.resolveMarket(v5pay, v5payOpts[0].id));
const bobPaid = (await db.query(
  `select payout from public.bets where market_id=$1 and user_id=$2`, [v5pay, users.bob])).rows[0].payout;
check('projectedPayout(7, 10, 90) matches the coins actually paid',
  projected === bobPaid, `projected ${projected}, paid ${bobPaid}`);

// exhaustive check against the server's integer formula
let payoutDrift = 0;
for (let win = 1; win <= 120; win++)
  for (let lose = 0; lose <= 120; lose++)
    for (const stake of [1, 3, 7, 49]) {
      if (stake > win) continue;
      const server = stake + Math.floor((stake * lose) / win);
      if (lib.projectedPayout(stake, win, win + lose) !== server) payoutDrift++;
    }
check('projectedPayout matches the server across ~50k pools', payoutDrift === 0,
  `${payoutDrift} mismatches`);

// ---- v5.5 evidence storage path segments must agree -----------------
// Storage itself is stubbed, so assert on the POLICY text: both read and upload
// have to tie the path's circle to the market's real circle.
const evPolicies = (await db.query(`
  select polname, pg_get_expr(polqual, polrelid) as using_expr,
         pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy where polname in ('evidence_read','evidence_upload')`)).rows;
check('evidence policies exist', evPolicies.length === 2);
for (const p of evPolicies) {
  const body = (p.using_expr || '') + (p.check_expr || '');
  check(`${p.polname} ties the path circle to the market's circle`,
    body.includes('market_circle') && body.includes('evidence_circle_id'),
    body);
}

// =====================================================================
section('v6 evidence limits');
//
// Storage itself is stubbed, so file SIZE and TYPE cannot be tested here - those are
// bucket settings enforced by Supabase Storage (see the smoke test in BACKEND.md).
// What CAN be tested is everything the database decides: the per-market file cap, the
// per-circle and whole-bucket byte caps, and who may delete what. Files are inserted
// into storage.objects through the `authenticated` role, so the real policies run.

// Runs one statement as a signed-in user, with RLS on. Returns { rows } or { error }.
async function sqlAs(userId, sql, params = []) {
  await db.exec('set role authenticated;');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role;'); }
}
let fileSeq = 0;
// pad='00' gives '005/0012/x.jpg', which the policies read as circle 5, market 12.
const fpath = (c, m, pad = '') => `${pad}${c}/${pad}${m}/f${++fileSeq}.jpg`;
const put = (uid, c, m, pad = '', size = 1000) => sqlAs(uid,
  `insert into storage.objects (bucket_id, name, owner, metadata)
   values ('evidence', $1, $2, jsonb_build_object('size', $3::bigint)) returning name`,
  [fpath(c, m, pad), uid, size]);
const status = async (uid, marketId) =>
  (await sqlAs(uid, `select public.evidence_upload_status($1) as s`, [marketId]));
const inTheFuture = () => new Date(Date.now() + 86_400_000);

// the limits, in one place
const lim = (await db.query(`select * from public.evidence_limits()`)).rows[0];
check('evidence_limits(): 2 MiB, 6 files, 100 MiB per circle, 800 MiB total, 30 days',
  lim.max_file_bytes === 2097152 && lim.max_files_per_market === 6
  && Number(lim.max_circle_bytes) === 104857600 && Number(lim.max_total_bytes) === 838860800
  && lim.purge_after_days === 30, JSON.stringify(lim));

// the bucket is what Storage enforces size and type against
const bucketNow = async () =>
  (await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'evidence'`)).rows[0];
let bkt = await bucketNow();
check('the evidence bucket is limited to 2 MiB JPEGs',
  Number(bkt.file_size_limit) === 2097152 && bkt.allowed_mime_types?.join() === 'image/jpeg', JSON.stringify(bkt));

// v5 inserted the bucket with `on conflict do nothing`, so a re-run never tightened an
// existing one. Loosen it, run the whole schema again, and it must be tight again.
await db.query(`update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'evidence'`);
await db.exec(readFileSync(ROOT + '/supabase/migrations/0001_initial.sql', 'utf8'));
bkt = await bucketNow();
check('re-running the schema tightens an existing, unlimited bucket',
  Number(bkt.file_size_limit) === 2097152 && bkt.allowed_mime_types?.join() === 'image/jpeg', JSON.stringify(bkt));

// ---- a circle to work in: alice creates and administers, bob is a member,
//      carol is (for now) an outsider
as('alice');
const evC = must('evidence circle', await lib.createCircle('Evidence limits circle'));
const evCode = must('evidence circle code', await lib.getCircle(evC)).join_code;
as('bob');   must('bob joins', await lib.joinCircle(evCode));
const evMk = async (who = 'alice') => { as(who); return must('evidence market', await lib.createMarket({
  circleId: evC, question: 'Evidence test market', kind: 'binary', closesAt: inTheFuture() })); };
const E1 = await evMk(), E2 = await evMk(), E3 = await evMk();

// ---- who may upload
let st = (await status(users.bob, E1)).rows[0].s;
check('status: a member may upload to an open market', st.allowed === true && st.reason === null && st.files === 0
  && st.max_files === 6 && st.max_file_bytes === 2097152, JSON.stringify(st));
const outsider = await status(users.carol, E1);
check('status: a market you cannot see reads "Market not found"',
  outsider.error?.includes('Market not found'), outsider.error);
const outsiderPut = await put(users.carol, evC, E1);
check('an outsider cannot upload (RLS refuses)', outsiderPut.error?.includes('row-level security'), outsiderPut.error);
const okPut = await put(users.bob, evC, E1);
check('a member can upload to an open market', !okPut.error, okPut.error);

// ---- per-market file cap (6). One is in; add five more through a mix of plain and
//      zero-padded paths - both must count toward the same market.
for (let i = 0; i < 4; i++) must(`file ${i + 2}`, await put(users.bob, evC, E1));
must('file 6, zero-padded path', await put(users.bob, evC, E1, '00'));
st = (await status(users.bob, E1)).rows[0].s;
check('status: six files means the market is full',
  st.allowed === false && st.files === 6 && st.reason === 'This market already has 6 photos', JSON.stringify(st));
const seventh = await put(users.bob, evC, E1);
check('the 7th file on a market is refused', seventh.error?.includes('row-level security'), seventh.error);
const seventhPadded = await put(users.bob, evC, E1, '000');
check('...including by zero-padding the path to dodge the count',
  seventhPadded.error?.includes('row-level security'), seventhPadded.error);
check('another market in the same circle is unaffected', !(await put(users.bob, evC, E2)).error);

// ---- per-circle byte cap (100 MiB). The last upload can overshoot, so put the circle AT
//      the cap with one stored file, then the next is refused.
await db.query(`insert into storage.objects (bucket_id, name, owner, metadata)
  values ('evidence', $1, $2, jsonb_build_object('size', $3::bigint))`,
  [fpath(evC, E3), users.bob, Number(lim.max_circle_bytes)]);
st = (await status(users.bob, E3)).rows[0].s;
check('status: a circle at its byte cap is full',
  st.allowed === false && st.reason === "This circle's photo storage is full"
  && Number(st.circle_bytes) >= Number(lim.max_circle_bytes), JSON.stringify(st));
const fullCircle = await put(users.bob, evC, E3);
check('an upload into a full circle is refused', fullCircle.error?.includes('row-level security'), fullCircle.error);
await db.query(`delete from storage.objects where bucket_id = 'evidence' and (metadata->>'size')::bigint >= $1`,
  [Number(lim.max_circle_bytes)]);

// ---- whole-bucket cap (800 MiB), seen from a different, nearly empty circle
as('bob');
const evC2 = must('second circle', await lib.createCircle('Bob small circle'));
const evOther = must('other market', await lib.createMarket({
  circleId: evC2, question: 'Another circle', kind: 'binary', closesAt: inTheFuture() }));
check('a nearly empty circle can upload', !(await put(users.bob, evC2, evOther)).error);
await db.query(`insert into storage.objects (bucket_id, name, owner, metadata)
  values ('evidence', $1, $2, jsonb_build_object('size', $3::bigint))`,
  [fpath(evC, E3), users.alice, Number(lim.max_total_bytes)]);
st = (await status(users.bob, evOther)).rows[0].s;
check('status: the whole bucket at its cap is full for every circle',
  st.allowed === false && st.reason === 'Photo storage is full for now', JSON.stringify(st));
check('...and uploads anywhere are refused',
  (await put(users.bob, evC2, evOther)).error?.includes('row-level security'));
await db.query(`delete from storage.objects where bucket_id = 'evidence' and (metadata->>'size')::bigint >= $1`,
  [Number(lim.max_total_bytes)]);
check('once space is freed, uploads work again', !(await put(users.bob, evC2, evOther)).error);

// ---- deleting, while the market is unsettled
as('carol'); must('carol joins as a plain member', await lib.joinCircle(evCode));
const del = (uid, name) => sqlAs(uid, `delete from storage.objects where bucket_id = 'evidence' and name = $1 returning name`, [name]);
const bobFile = (await put(users.bob, evC, E2)).rows[0].name;
check('a plain member cannot delete someone else\'s file', (await del(users.carol, bobFile)).rows.length === 0);
check('the uploader can delete their own file', (await del(users.bob, bobFile)).rows.length === 1);
const bobFile2 = (await put(users.bob, evC, E2)).rows[0].name;
check('the market creator (also admin) can delete a member\'s file', (await del(users.alice, bobFile2)).rows.length === 1);

// ---- why files have to go BEFORE cancel_market
const E4 = await evMk();
const beforeCancel = (await put(users.bob, evC, E4)).rows[0].name;
as('alice'); must('cancel market', await lib.cancelMarket(E4));
check('after cancel_market its files are unreachable: nobody can delete them (so the app removes them first)',
  (await del(users.alice, beforeCancel)).rows.length === 0);
await db.query(`delete from storage.objects where name = $1`, [beforeCancel]);   // tidy the test data

// ---- settled evidence: frozen, then purgeable by an admin after 30 days
const E5 = await evMk();
const keep = (await put(users.bob, evC, E5)).rows[0].name;
const rowIns = async (name) => (await sqlAs(users.bob,
  `insert into public.market_evidence (market_id, uploader_id, storage_path, media_type)
   values ($1, $2, $3, 'image') returning id`, [E5, users.bob, name]));
const evRowId = (await rowIns(keep)).rows[0].id;
const optE5 = must('E5 options', await lib.getOptions(E5))[0].id;
as('alice'); must('settle E5', await lib.resolveMarket(E5, optE5));
check('a settled market takes no new files', (await put(users.bob, evC, E5)).error?.includes('row-level security'));
check('...and its uploader cannot delete their file', (await del(users.bob, keep)).rows.length === 0);
check('...and even an admin cannot, inside the 30 days', (await del(users.alice, keep)).rows.length === 0);
check('...nor delete its evidence row', (await sqlAs(users.alice,
  `delete from public.market_evidence where id = $1 returning id`, [evRowId])).rows.length === 0);
let frozen;
try { await db.query(`update public.market_evidence set caption = 'edited' where id = $1`, [evRowId]); frozen = 'no error'; }
catch (e) { frozen = e.message; }
check('the guard still freezes edits to settled evidence', /frozen/.test(frozen), frozen);

// backdate the settlement by 31 days (break-glass: the guard blocks any update of a settled market)
await db.exec(`alter table public.markets disable trigger markets_terminal_guard`);
await db.query(`update public.markets set resolved_at = now() - interval '31 days' where id = $1`, [E5]);
await db.exec(`alter table public.markets enable trigger markets_terminal_guard`);
check('31 days on, a plain member (the uploader) still cannot delete it', (await del(users.bob, keep)).rows.length === 0);
check('...but a circle admin can delete the file',  (await del(users.alice, keep)).rows.length === 1);
check('...and the evidence row goes with it, past the guard', (await sqlAs(users.alice,
  `delete from public.market_evidence where id = $1 returning id`, [evRowId])).rows.length === 1);
let stillFrozen;
try { await db.query(`insert into public.market_evidence (market_id, uploader_id, storage_path, media_type)
  values ($1, $2, 'x/y/z.jpg', 'image')`, [E5, users.bob]); stillFrozen = 'no error'; }
catch (e) { stillFrozen = e.message; }
check('...but settled evidence still cannot be ADDED, even after 30 days', /frozen/.test(stillFrozen), stillFrozen);

// ---- the surface: who can call what
const anonCall = await (async () => {
  await db.exec('set role anon;');
  try { await db.query(`select public.evidence_upload_status(1)`); return 'callable'; }
  catch (e) { return e.message; } finally { await db.exec('reset role;'); }
})();
check('anon cannot call evidence_upload_status', /permission denied/.test(anonCall), anonCall);
const counterCall = await sqlAs(users.bob, `select public.evidence_total_bytes()`);
check('the internal counters are not callable from the client', /permission denied/.test(counterCall.error ?? ''), counterCall.error);


// ---- the same rules, through the lib -------------------------------------
const jpegOf = (bytes) => new File([new Uint8Array(bytes)], 'p.jpg', { type: 'image/jpeg' });
as('bob');
const libSt = await lib.getEvidenceUploadStatus(E2);
check('getEvidenceUploadStatus reports the limits the database enforces',
  libSt.data?.allowed === true && libSt.data.max_files === 6 && libSt.data.max_file_bytes === 2097152
  && libSt.data.purge_after_days === 30, JSON.stringify(libSt));
as('alice');
expectErr('getEvidenceUploadStatus: a market in a circle you are not in',
  await lib.getEvidenceUploadStatus(evOther), 'Market not found');
as('bob');
expectErr('uploadEvidence: a market that is already full says so, in a sentence',
  await lib.uploadEvidence(jpegOf(10), { marketId: E1 }), 'This market already has 6 photos');
expectErr('uploadEvidence: a photo over the size limit is refused before storage',
  await lib.uploadEvidence(jpegOf(2 * 1024 * 1024 + 1), { marketId: E2 }), 'too large');
expectErr('uploadEvidence: a settled market takes no photos',
  await lib.uploadEvidence(jpegOf(10), { marketId: E5 }), 'has settled');
const reached = await lib.uploadEvidence(jpegOf(1000), { marketId: E2 });
check('uploadEvidence: a normal photo gets as far as storage',
  reached.error === 'storage not available in sandbox', reached.error);
check('preparePhoto explains itself outside a browser',
  (await lib.preparePhoto(new Blob(['x'], { type: 'image/jpeg' }), 2_000_000)).error?.includes('browser'));
check('getEvidenceUrls with nothing to sign is an empty map',
  JSON.stringify((await lib.getEvidenceUrls([])).data) === '{}');

// removeMarketFiles: the creator clears a market; a plain member's call removes only their own
const seedRow = (uid, mkt) => sqlAs(uid,
  `insert into public.market_evidence (market_id, uploader_id, storage_path, media_type)
   values ($1, $2, $3, 'image') returning id`, [mkt, uid, fpath(evC, mkt)]);
await seedRow(users.bob, E2); await seedRow(users.bob, E2); await seedRow(users.carol, E2);
const rowCount = async (mkt) => (await db.query(
  `select count(*)::int n from public.market_evidence where market_id = $1`, [mkt])).rows[0].n;
as('carol');
must('carol (a plain member) runs removeMarketFiles', await lib.removeMarketFiles(E2));
check('removeMarketFiles by a plain member removes only their own rows', (await rowCount(E2)) === 2);
as('alice');
must('alice (creator and admin) runs removeMarketFiles', await lib.removeMarketFiles(E2));
check('removeMarketFiles by the market creator removes them all', (await rowCount(E2)) === 0);
expectErr('removeMarketFiles on a market you cannot see', await lib.removeMarketFiles(evOther), 'Market not found');


// =====================================================================
section('v7 standing markets (no closes_at)');
//
// "Next person to blackout" has nothing to schedule: nobody knows when it will
// happen. closesAt is now optional - omitting it means betting never
// auto-closes, and a result can be proposed the moment it actually happens,
// with no minimum wait.

// ---- the pure timing helpers, checked directly against constructed markets.
//      No network involved, so this is where the null-handling itself is proven.
const baseMarket = {
  status: 'open', kind: 'binary', line: null, options_lock_at: null,
  event_end_at: null, review_started_at: null,
};
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const hoursFromNow = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

check('isBettingOpen: true forever once opened, when closes_at is null',
  lib.isBettingOpen({ ...baseMarket, opens_at: hoursAgo(1), closes_at: null }));
check('isBettingOpen: still false before opens_at, even with no closes_at',
  !lib.isBettingOpen({ ...baseMarket, opens_at: hoursFromNow(1), closes_at: null }));
check('isBettingOpen: false once settled, regardless of closes_at',
  !lib.isBettingOpen({ ...baseMarket, status: 'resolved', opens_at: hoursAgo(1), closes_at: null }));

check('canProposeResolution: true immediately when there is nothing to wait for',
  lib.canProposeResolution({ ...baseMarket, opens_at: hoursAgo(1), closes_at: null }));
check('canProposeResolution: an explicit eventEndAt still gates a standing market',
  !lib.canProposeResolution({ ...baseMarket, opens_at: hoursAgo(1), closes_at: null, event_end_at: hoursFromNow(1) }));

check('canSubmitOption: open kind, no closes_at and no derived lock -> always open',
  lib.canSubmitOption({ ...baseMarket, kind: 'open', opens_at: hoursAgo(1), closes_at: null }));
check('canSubmitOption: still respects an explicit options_lock_at',
  !lib.canSubmitOption({ ...baseMarket, kind: 'open', opens_at: hoursAgo(1), closes_at: null, options_lock_at: hoursAgo(1) }));

// ---- the real thing: create, bet, add an option, propose - all with no closes_at
const standingId = must('create a market with no end date',
  await lib.createMarket({ circleId, question: 'Next person to blackout', kind: 'open' }));
const standing = must('read it back', await lib.getMarket(standingId));
check('closes_at is really null in the database, not just unset client-side',
  standing.closes_at === null, standing.closes_at);
check('options_lock_at is null too - nothing derived from a close time that does not exist',
  standing.options_lock_at === null);

must('submit_option works with no lock to respect',
  await lib.submitOption(standingId, 'Bob'));
const bobOptId = must('submit_option (Zach)', await lib.submitOption(standingId, 'Zach'));
must('betting has no upper bound', await lib.placeBet(standingId, bobOptId, 20));

// propose_resolution the same second the market was created - no minimum wait
const standingProposalId = must('propose a result seconds after creation, with no minimum wait',
  await lib.proposeResolution(standingId, bobOptId, 'Zach went down at the after-party'));
check('the quarantine line was still drawn like any other proposal',
  (await lib.getMarket(standingId)).review_started_at !== null);

// reject_close on a standing market: least(NULL, now()) returns now() (LEAST
// ignores a null argument), so this closes betting at the current moment even
// though there was never a scheduled close to pull forward.
as('alice');
must('reject_close on a standing market', await lib.reviewProposal(standingProposalId, 'reject_close'));
const closedStanding = must('read it back after reject_close', await lib.getMarket(standingId));
check('reject_close gave it a real closes_at (now), not null forever',
  closedStanding.closes_at !== null);
check('...specifically in the past, so betting is actually shut',
  new Date(closedStanding.closes_at) <= new Date());
check('...and status reflects that', closedStanding.status === 'closed');
check('a bet no longer goes through',
  (await lib.placeBet(standingId, bobOptId, 5)).error === 'Betting has closed');

as('bob');
check('drift is still 0 after every v7 scenario',
  (await db.query(`select count(*)::int n from public.circle_reconciliation where drift <> 0`)).rows[0].n === 0);


// ---- the invariant that outranks all of them ------------------------
check('drift is still 0 after every v5 scenario',
  (await db.query(`select count(*)::int n from public.circle_reconciliation where drift <> 0`)).rows[0].n === 0);


// =====================================================================
console.log(`\n${'='.repeat(64)}`);
console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
