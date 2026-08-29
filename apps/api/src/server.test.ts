import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from './server.js';

test('health endpoint is available from the backend app', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/health',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('markets endpoint returns market summaries from the backend', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/markets',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().count, 2);
  assert.equal(Array.isArray(response.json().markets), true);
});

test('circles endpoint returns circle summaries from the backend', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/circles',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().count, 2);
  assert.equal(Array.isArray(response.json().circles), true);
  assert.equal(response.json().circles[0].name, 'Friend Circle');
});

test('bets endpoint returns bet summaries for a market', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/bets?marketId=mkt-1',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().count, 2);
  assert.equal(Array.isArray(response.json().bets), true);
  assert.equal(response.json().bets[0].marketId, 'mkt-1');
});

test('market options endpoint returns option definitions from the backend', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/markets/mkt-1/options',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().count, 2);
  assert.equal(Array.isArray(response.json().options), true);
  assert.equal(response.json().options[0].label, 'Yes');
});

test('market odds endpoint returns odds snapshots from the backend', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/markets/mkt-1/odds',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().count, 2);
  assert.equal(Array.isArray(response.json().odds), true);
  assert.equal(response.json().odds[0].pool, 72);
});
