/**
 * Stateless HMAC session tokens — Edge-safe (Web Crypto + TextEncoder only).
 *
 * Token format: v1.<iat>.<exp>.<sig>
 *   sig = base64url( HMAC-SHA256( K_session, "v1.<iat>.<exp>" ) )
 *   K_session = HMAC-SHA256( key = utf8(MC_UI_TOKEN), data = "mc-session-signing-v1" )
 *
 * Minted in the Node login route and verified in the Edge middleware — both
 * via Web Crypto, so this module must not import any node:* API. Rotating
 * MC_UI_TOKEN invalidates every outstanding session; bumping the version
 * literal is a code-level global logout.
 */

export const SESSION_TTL_S = 2592000; // 30 d
export const RENEW_THRESHOLD_S = 1296000; // 15 d
export const MAX_SESSION_AGE_S = 7776000; // 90 d absolute cap — quarterly re-login

const VERSION = 'v1';
const SIGNING_CONTEXT = 'mc-session-signing-v1';

const encoder = new TextEncoder();

/**
 * `__Host-` requires Secure + host-only + Path=/ (browser-enforced), which
 * needs HTTPS — so prod only; plain name keeps http://localhost dev working.
 */
export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-mc_session' : 'mc_session';
}

let keyCache: { token: string; key: Promise<CryptoKey> } | null = null;

/** Session signing key, domain-separated from MC_UI_TOKEN; memoized per process. */
export function deriveSessionKey(uiToken: string): Promise<CryptoKey> {
  if (keyCache?.token === uiToken) return keyCache.key;
  const key = (async () => {
    const master = await crypto.subtle.importKey(
      'raw',
      encoder.encode(uiToken),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const derived = await crypto.subtle.sign('HMAC', master, encoder.encode(SIGNING_CONTEXT));
    return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
  })();
  keyCache = { token: uiToken, key };
  return key;
}

export async function createSessionToken(key: CryptoKey, iat: number, exp: number): Promise<string> {
  const payload = `${VERSION}.${iat}.${exp}`;
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(sig))}`;
}

export type SessionVerification = { ok: true; iat: number; exp: number } | { ok: false };

export async function verifySessionToken(
  key: CryptoKey,
  token: string | undefined,
  now: number,
): Promise<SessionVerification> {
  if (!token) return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return { ok: false };
  const iat = Number(parts[1]);
  const exp = Number(parts[2]);
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return { ok: false };
  const sig = base64urlDecode(parts[3]);
  if (!sig) return { ok: false };
  // Rebuilding the payload from the parsed ints also enforces canonical form.
  const payload = `${VERSION}.${iat}.${exp}`;
  // crypto.subtle.verify is constant-time internally — no hand-rolled compare.
  const valid = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(payload));
  if (!valid) return { ok: false };
  if (exp < now) return { ok: false };
  if (now - iat > MAX_SESSION_AGE_S) return { ok: false };
  return { ok: true, iat, exp };
}

let compareKey: Promise<CryptoKey> | null = null;

/**
 * Constant-time string compare for the bearer rail. The Edge runtime lacks
 * crypto.timingSafeEqual, so both sides are HMAC'd with a per-boot random key
 * and the fixed-length, secret-keyed MACs are compared.
 */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  if (!compareKey) {
    compareKey = crypto.subtle.importKey(
      'raw',
      crypto.getRandomValues(new Uint8Array(32)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  const key = await compareKey;
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(macA);
  const bytesB = new Uint8Array(macB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
