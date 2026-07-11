import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SESSION_AGE_S,
  SESSION_TTL_S,
  createSessionToken,
  deriveSessionKey,
  sessionCookieName,
  timingSafeEqualStr,
  verifySessionToken,
} from './session';

const NOW = 1_800_000_000; // fixed epoch seconds

// ---------- sign / verify ----------

test('round-trip: sign then verify ok with iat/exp preserved', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const token = await createSessionToken(key, NOW, NOW + SESSION_TTL_S);
  const result = await verifySessionToken(key, token, NOW + 10);
  assert.deepEqual(result, { ok: true, iat: NOW, exp: NOW + SESSION_TTL_S });
});

test('tampered signature rejected', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const token = await createSessionToken(key, NOW, NOW + SESSION_TTL_S);
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  assert.deepEqual(await verifySessionToken(key, flipped, NOW + 10), { ok: false });
});

test('tampered payload (extended exp) rejected', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const token = await createSessionToken(key, NOW, NOW + SESSION_TTL_S);
  const [version, iat, exp, sig] = token.split('.');
  const forged = [version, iat, String(Number(exp) + 3600), sig].join('.');
  assert.deepEqual(await verifySessionToken(key, forged, NOW + 10), { ok: false });
});

test('expired token rejected', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const token = await createSessionToken(key, NOW, NOW + 60);
  assert.deepEqual(await verifySessionToken(key, token, NOW + 61), { ok: false });
});

test('max session age exceeded rejected even with a future exp', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const iat = NOW - MAX_SESSION_AGE_S - 1;
  const token = await createSessionToken(key, iat, NOW + SESSION_TTL_S);
  assert.deepEqual(await verifySessionToken(key, token, NOW), { ok: false });
});

test('malformed tokens rejected', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const bad = [
    undefined,
    '',
    'v1',
    'v1.1.2',
    'v2.1.2.AAAA',
    'v1.abc.2.AAAA',
    'v1.1.2.$$$$',
    'v1.1.2.3.4',
    `v1.1.5e99.AAAA`,
  ];
  for (const token of bad) {
    assert.deepEqual(
      await verifySessionToken(key, token as string | undefined, NOW),
      { ok: false },
      `should reject: ${String(token)}`,
    );
  }
});

test('key rotation (different MC_UI_TOKEN) invalidates outstanding sessions', async () => {
  const oldKey = await deriveSessionKey('old-ui-token');
  const newKey = await deriveSessionKey('new-ui-token');
  const token = await createSessionToken(oldKey, NOW, NOW + SESSION_TTL_S);
  assert.deepEqual(await verifySessionToken(newKey, token, NOW), { ok: false });
});

test('renewal re-sign preserves original iat with a fresh exp', async () => {
  const key = await deriveSessionKey('test-ui-token');
  const iat = NOW - 20 * 86400; // 20 d old — inside the 90 d cap
  const renewed = await createSessionToken(key, iat, NOW + SESSION_TTL_S);
  const result = await verifySessionToken(key, renewed, NOW);
  assert.deepEqual(result, { ok: true, iat, exp: NOW + SESSION_TTL_S });
});

// ---------- cookie name ----------

test('cookie name: __Host- prefix in production, plain otherwise', () => {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;
  try {
    env.NODE_ENV = 'production';
    assert.equal(sessionCookieName(), '__Host-mc_session');
    env.NODE_ENV = 'test';
    assert.equal(sessionCookieName(), 'mc_session');
  } finally {
    env.NODE_ENV = original;
  }
});

// ---------- timing-safe compare ----------

test('timingSafeEqualStr: equal, unequal, and length-mismatch', async () => {
  assert.equal(await timingSafeEqualStr('secret-token', 'secret-token'), true);
  assert.equal(await timingSafeEqualStr('secret-token', 'secret-tokeX'), false);
  assert.equal(await timingSafeEqualStr('short', 'much-longer-value'), false);
});
