import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import {
  SESSION_TTL_S,
  createSessionToken,
  deriveSessionKey,
  sessionCookieName,
} from '@/lib/auth/session';
import { isThrottled, registerFailure, resetFailures } from '@/lib/auth/rate-limit';

export const dynamic = 'force-dynamic';

const TARPIT_MS = 300;

/**
 * POST /api/auth/login — exchanges the MC_UI_TOKEN access key for a signed
 * session cookie. Exempted from the auth middleware, so the hardening lives
 * here: per-IP + global throttle, constant-time compare, uniform error body,
 * ~300 ms failure tarpit. Never logs the submitted key or any token material.
 */
export async function POST(request: NextRequest) {
  const uiToken = process.env.MC_UI_TOKEN;
  if (!uiToken) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  }

  const ip = clientIp(request);
  const throttle = isThrottled(ip);
  if (throttle.throttled) {
    console.warn(`[AUTH] login throttled (ip=${ip})`);
    return NextResponse.json(
      { error: 'Too many attempts' },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterS) } },
    );
  }

  let candidate: string | null = null;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && typeof (body as { key?: unknown }).key === 'string') {
      candidate = (body as { key: string }).key;
    }
  } catch {
    // malformed or missing body — uniform failure below
  }

  if (!candidate || !constantTimeMatch(candidate, uiToken)) {
    registerFailure(ip);
    console.warn(`[AUTH] failed login attempt (ip=${ip})`);
    await new Promise((resolve) => setTimeout(resolve, TARPIT_MS));
    return NextResponse.json({ error: 'Invalid access key' }, { status: 401 });
  }

  resetFailures(ip);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_S;
  const token = await createSessionToken(await deriveSessionKey(uiToken), now, exp);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: exp - now,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

/** SHA-256 both sides (length-normalize), then timingSafeEqual. */
function constantTimeMatch(candidate: string, actual: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(candidate).digest(),
    createHash('sha256').update(actual).digest(),
  );
}

// Trusted because the origin firewall admits only Cloudflare, which sets
// CF-Connecting-IP; XFF is Caddy-set for loopback/LAN testing only.
function clientIp(request: NextRequest): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.ip ?? 'unknown';
}
