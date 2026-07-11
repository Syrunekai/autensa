import test from 'node:test';
import assert from 'node:assert/strict';
import { csrfSafe } from './csrf';

function requestWith(secFetchSite: string | null) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'sec-fetch-site' ? secFetchSite : null),
    },
  };
}

test('same-origin allowed', () => {
  assert.equal(csrfSafe(requestWith('same-origin')), true);
});

test('none allowed (user-initiated top-level navigation)', () => {
  assert.equal(csrfSafe(requestWith('none')), true);
});

test('cross-site rejected', () => {
  assert.equal(csrfSafe(requestWith('cross-site')), false);
});

test('same-site rejected (sibling subdomain)', () => {
  assert.equal(csrfSafe(requestWith('same-site')), false);
});

test('absent rejected (deny-on-absent, no legacy fallback)', () => {
  assert.equal(csrfSafe(requestWith(null)), false);
});

test('unrecognized value rejected', () => {
  assert.equal(csrfSafe(requestWith('websocket')), false);
});
