// Sample data for the demo, created through the same functions the app uses, so it is
// indistinguishable from data people made by hand.
//   as(key)  a client acting as that user      sql(q, params)  superuser query, rows back
//   photo(who, circleId, marketId, caption, hue)  adds a generated placeholder photo
export async function seed({ as, sql, photo }) {
  const must = (res, what) => {
    if (res.error) throw new Error(`demo seed: ${what}: ${res.error.message}`);
    return res.data;
  };
  // Everything past the circle itself is decoration; a failure there should not brick the demo.
  const soft = async (what, fn) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[demo] skipped "${what}":`, err.message);
    }
  };

  const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
  const optionId = async (marketId, label) =>
    (await sql('select id from market_options where market_id = $1 and label = $2', [marketId, label]))[0].id;

  const circleId = must(await as('alice').rpc('create_circle', { _name: 'Friday Crew' }), 'create circle');
  const [{ join_code }] = await sql('select join_code from circles where id = $1', [circleId]);
  must(await as('bob').rpc('join_circle', { _join_code: join_code }), 'bob joins');
  must(await as('cara').rpc('join_circle', { _join_code: join_code }), 'cara joins');

  const market = async (who, fields) =>
    must(
      await as(who).rpc('create_market', {
        _circle_id: circleId,
        _options: null,
        _line: null,
        _subject_id: null,
        _opens_at: null,
        _event_start_at: null,
        _event_end_at: null,
        _image_url: null,
        ...fields,
      }),
      `create "${fields._question}"`,
    );
  const bet = async (who, marketId, label, amount) =>
    must(
      await as(who).rpc('place_bet', {
        _market_id: marketId,
        _option_id: await optionId(marketId, label),
        _amount: amount,
      }),
      `${who} bets on ${label}`,
    );
  // v9: comments are one running chat per circle, not per market.
  const comment = async (who, body) => {
    const [{ id }] = await sql('select id from auth.users where email = $1', [`${who}@demo.test`]);
    must(await as(who).from('comments').insert({ circle_id: circleId, user_id: id, body }).select().single(), 'comment');
  };
  const backdate = (marketId) =>
    sql(
      `update markets set opens_at = now() - interval '5 hours', closes_at = now() - interval '3 hours',
                          event_end_at = now() - interval '2 hours' where id = $1`,
      [marketId],
    );

  // Open for betting: one of each kind.
  const sam = await market('alice', { _question: 'Will Sam show up on time?', _kind: 'binary', _closes_at: hours(26) });
  await soft('bets on Sam', async () => {
    await bet('bob', sam, 'Yes', 50);
    await bet('cara', sam, 'No', 30);
    await bet('alice', sam, 'Yes', 20);
    await comment('bob', 'Sam is never on time. Easy money.');
    await comment('cara', 'Bold of you to assume he owns a watch.');
    await photo('alice', circleId, sam, 'Sam, 7:41pm', 200);
  });

  await soft('standing market with no end date', async () => {
    const m = await market('bob', {
      _question: 'Next person to blackout',
      _kind: 'multi',
      _options: ['Alice', 'Bob', 'Cara'],
      // v7: omitting _closes_at makes this a standing bet - nobody knows when
      // it will happen, so there is nothing to schedule.
    });
    await bet('cara', m, 'Bob', 20);
    await bet('alice', m, 'Bob', 10);
    await comment('bob', "Rude, but I'll take the action anyway.");
  });

  await soft('tournament market', async () => {
    const m = await market('bob', {
      _question: 'Who wins the tournament?',
      _kind: 'multi',
      _options: ['Sam', 'Alex', 'Jo'],
      _closes_at: hours(50),
    });
    await bet('alice', m, 'Alex', 40);
    await bet('cara', m, 'Sam', 25);
    await bet('bob', m, 'Jo', 10);
  });

  await soft('over/under market', async () => {
    const m = await market('cara', {
      _question: 'How many goals in the final?',
      _kind: 'over_under',
      _line: 2.5,
      _closes_at: hours(74),
    });
    await bet('bob', m, 'Over 2.5', 30);
    await bet('cara', m, 'Under 2.5', 30);
  });

  await soft('open-entries market', async () => {
    const m = await market('alice', { _question: 'Best pizza topping?', _kind: 'open', _closes_at: hours(30) });
    must(await as('bob').rpc('submit_option', { _market_id: m, _label: 'Pepperoni' }), 'option');
    must(await as('cara').rpc('submit_option', { _market_id: m, _label: 'Pineapple' }), 'option');
    await bet('alice', m, 'Pepperoni', 15);
  });

  // Betting closed, nobody has proposed a result yet: try "Propose result", vote, then approve as Alice.
  await soft('awaiting-result market', async () => {
    const m = await market('alice', { _question: 'Did the pizza arrive by 8pm?', _kind: 'binary', _closes_at: hours(2) });
    await bet('bob', m, 'Yes', 60);
    await bet('cara', m, 'No', 40);
    await bet('alice', m, 'Yes', 20);
    await comment('alice', 'Ruling pending. Bring receipts.');
    await photo('bob', circleId, m, 'Pizza at the door, 8:02', 20);
    await photo('cara', circleId, m, 'Order said 7:40', 320);
    await backdate(m);
  });

  // Already settled, so Standings and Alerts have something in them.
  await soft('settled market', async () => {
    const m = await market('cara', { _question: 'Did Alex bring the snacks?', _kind: 'binary', _closes_at: hours(2) });
    await bet('bob', m, 'Yes', 40);
    await bet('cara', m, 'No', 20);
    await backdate(m);
    must(await as('alice').rpc('resolve_market', { _market_id: m, _winning_option_id: await optionId(m, 'Yes') }), 'resolve');
  });
}
