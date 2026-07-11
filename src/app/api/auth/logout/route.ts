import { NextResponse } from 'next/server';
import { sessionCookieName } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout — cookie-authenticated: requests only reach here past
 * the middleware cookie rail and its CSRF guard. Clears the session cookie;
 * the signed token itself stays valid until exp, so rotating MC_UI_TOKEN is
 * the kill switch for a stolen cookie.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
