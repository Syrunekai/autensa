/**
 * Hard boot-refusal on production auth misconfiguration — defense-in-depth;
 * the middleware 503 remains the load-bearing gate even if this throw does
 * not abort the server in some future Next version.
 */
export async function register() {
  if (process.env.NODE_ENV !== 'production') return;
  const demoMode = process.env.DEMO_MODE === 'true';
  if (!process.env.MC_UI_TOKEN || !process.env.MC_API_TOKEN || demoMode) {
    console.error(
      '[FATAL] auth misconfigured: production requires MC_UI_TOKEN and MC_API_TOKEN set and DEMO_MODE unset — refusing to start',
    );
    throw new Error('Production auth misconfigured');
  }
}
