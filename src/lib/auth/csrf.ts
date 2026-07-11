/**
 * CSRF guard for cookie-authenticated /api/* requests (§3.6). The bearer rail
 * never reaches this check — no ambient credential means no CSRF.
 *
 * Sec-Fetch-Site is a browser-set forbidden header; page JavaScript cannot
 * forge it. `same-site` is rejected because sibling subdomains share the
 * registrable domain and would otherwise ride the cookie under SameSite=Lax.
 * Absent is rejected (deny-on-absent, no Origin/Referer fallback) — every
 * supported browser sends it; non-browser clients use the bearer rail.
 */

type HeaderReader = { headers: { get(name: string): string | null } };

export function csrfSafe(req: HeaderReader): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site === null) return false;
  return site === 'same-origin' || site === 'none';
}
