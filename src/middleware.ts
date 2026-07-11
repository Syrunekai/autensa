import { NextRequest, NextResponse } from 'next/server';
import {
  RENEW_THRESHOLD_S,
  SESSION_TTL_S,
  createSessionToken,
  deriveSessionKey,
  sessionCookieName,
  timingSafeEqualStr,
  verifySessionToken,
} from '@/lib/auth/session';
import { csrfSafe } from '@/lib/auth/csrf';
import { sanitizeNext } from '@/lib/auth/sanitize';

/**
 * App-wide auth gate. Browsers authenticate with the signed session cookie
 * (minted by /api/auth/login); automation uses `Authorization: Bearer
 * MC_API_TOKEN`. Nothing except /login, /api/auth/login, and the
 * HMAC-verified webhooks is reachable without one of those credentials.
 *
 * Runs on the Edge runtime — imports here must stay Web Crypto only
 * (no node:*, no better-sqlite3).
 */

const isProd = process.env.NODE_ENV === 'production';
const MC_UI_TOKEN = process.env.MC_UI_TOKEN;
const MC_API_TOKEN = process.env.MC_API_TOKEN;
const DEMO_MODE = process.env.DEMO_MODE === 'true';

// Production fails closed: half-configured is loudly 503, never silently open.
const PROD_MISCONFIG = isProd && (!MC_UI_TOKEN || !MC_API_TOKEN || DEMO_MODE);
if (PROD_MISCONFIG) {
  console.error(
    '[FATAL] auth misconfigured: production requires MC_UI_TOKEN and MC_API_TOKEN set and DEMO_MODE unset',
  );
}
const DEV_OPEN = !isProd && !MC_UI_TOKEN && !MC_API_TOKEN;
if (DEV_OPEN) {
  console.warn('[SECURITY WARNING] auth disabled (dev): MC_UI_TOKEN and MC_API_TOKEN both unset');
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Production fail-closed (fatal). Every route, no exceptions.
  if (PROD_MISCONFIG) {
    return NextResponse.json({ error: 'Server auth misconfigured' }, { status: 503 });
  }

  // 2. Always-allowed unauthenticated surfaces.
  if (pathname === '/login') return NextResponse.next(); // login page (self-hardened)
  if (pathname === '/api/auth/login') return NextResponse.next(); // throttle lives inside
  if (pathname.startsWith('/api/webhooks/')) return NextResponse.next(); // per-route HMAC

  // 3. Dev-only modes (never reached in prod: rule 1 catches the misconfig).
  if (DEMO_MODE && !isProd) return demoBehavior(request);
  if (DEV_OPEN) return NextResponse.next();

  // 4. Authenticate — bearer rail first (CSRF-exempt), then cookie rail.
  const bearer = parseBearer(request.headers.get('authorization'));
  if (bearer && MC_API_TOKEN && (await timingSafeEqualStr(bearer, MC_API_TOKEN))) {
    return NextResponse.next();
  }

  if (MC_UI_TOKEN) {
    const key = await deriveSessionKey(MC_UI_TOKEN);
    const now = Math.floor(Date.now() / 1000);
    const cookie = request.cookies.get(sessionCookieName())?.value;
    const session = await verifySessionToken(key, cookie, now);
    if (session.ok) {
      // CSRF guard on the cookie rail only; pages are read-only renders and
      // cross-site top-level navigation to them is intended UX.
      if (isApiPath(pathname) && !csrfSafe(request)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const response = NextResponse.next();
      if (session.exp - now < RENEW_THRESHOLD_S) {
        // Sliding renewal: fresh exp, original iat — the 90 d absolute cap is
        // enforced at verify, so renewal cannot extend a session forever.
        const exp = now + SESSION_TTL_S;
        setSessionCookie(response, await createSessionToken(key, session.iat, exp), exp - now);
      }
      return response;
    }
  }

  // 5. Unauthenticated.
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?next=${encodeURIComponent(sanitizeNext(pathname + search))}`;
  return NextResponse.redirect(loginUrl, 307);
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function parseBearer(header: string | null): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7) || null;
}

function setSessionCookie(response: NextResponse, value: string, maxAge: number): void {
  response.cookies.set(sessionCookieName(), value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    secure: isProd, // __Host- prefix (prod) additionally enforces Secure + host-only + Path=/
  });
}

// Upstream demo-mode behavior, kept verbatim; non-prod only (prod + DEMO_MODE
// is a rule-1 misconfig).
function demoBehavior(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/api/')) {
    const response = NextResponse.next();
    response.headers.set('X-Demo-Mode', 'true');
    return response;
  }
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    return NextResponse.json(
      { error: 'Demo mode — this is a read-only instance. Visit github.com/crshdn/mission-control to run your own!' },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'],
};
