/**
 * Open-redirect guard for the post-login `next` path. Imported by both the
 * middleware (Edge) and the login page (client bundle) — must stay free of
 * secrets and node:* imports.
 */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  // The URL parser strips ASCII tab/newline before resolving, so a value like
  // "/\t/evil.example" would otherwise become protocol-relative "//evil.example".
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) < 0x20) return '/';
  }
  return raw;
}
