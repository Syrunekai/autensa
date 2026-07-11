/**
 * In-memory login throttle (§3.5). Single-process deployment, so process
 * memory is the source of truth; state is lost on restart (accepted).
 */

const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 5;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX_FAILURES = 50;

const failuresByIp = new Map<string, number[]>();
let globalFailures: number[] = [];
let globalCapTripped = false;

export type ThrottleState = { throttled: boolean; retryAfterS: number };

export function isThrottled(ip: string, now: number = Date.now()): ThrottleState {
  pruneGlobal(now);
  if (globalFailures.length >= GLOBAL_MAX_FAILURES) {
    return { throttled: true, retryAfterS: secondsUntil(globalFailures[0] + GLOBAL_WINDOW_MS, now) };
  }
  const recent = pruneIp(ip, now);
  if (recent.length >= IP_MAX_FAILURES) {
    return { throttled: true, retryAfterS: secondsUntil(recent[0] + IP_WINDOW_MS, now) };
  }
  return { throttled: false, retryAfterS: 0 };
}

export function registerFailure(ip: string, now: number = Date.now()): void {
  const recent = pruneIp(ip, now);
  recent.push(now);
  failuresByIp.set(ip, recent);

  pruneGlobal(now);
  globalFailures.push(now);
  if (!globalCapTripped && globalFailures.length >= GLOBAL_MAX_FAILURES) {
    globalCapTripped = true;
    // Loud so a targeted lockout is distinguishable from fat-fingering (§3.5).
    console.warn(
      `[AUTH] global login failure cap tripped (${GLOBAL_MAX_FAILURES}/h) — login throttled for all IPs`,
    );
  }
  sweep(now);
}

export function resetFailures(ip: string): void {
  failuresByIp.delete(ip);
}

function pruneIp(ip: string, now: number): number[] {
  const cutoff = now - IP_WINDOW_MS;
  const recent = (failuresByIp.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length === 0) failuresByIp.delete(ip);
  else failuresByIp.set(ip, recent);
  return recent;
}

function pruneGlobal(now: number): void {
  const cutoff = now - GLOBAL_WINDOW_MS;
  globalFailures = globalFailures.filter((t) => t > cutoff);
  if (globalCapTripped && globalFailures.length < GLOBAL_MAX_FAILURES) globalCapTripped = false;
}

/** Lazy sweep of idle IPs so the map cannot grow unbounded. */
function sweep(now: number): void {
  const cutoff = now - IP_WINDOW_MS;
  failuresByIp.forEach((times, ip) => {
    if (times.length === 0 || times[times.length - 1] <= cutoff) failuresByIp.delete(ip);
  });
}

function secondsUntil(deadlineMs: number, now: number): number {
  return Math.max(1, Math.ceil((deadlineMs - now) / 1000));
}
