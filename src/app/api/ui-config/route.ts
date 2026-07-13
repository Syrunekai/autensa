import { NextResponse } from 'next/server';

// Evaluated per request; prevents build-time static caching of env values.
export const dynamic = 'force-dynamic';

const SWIPE_MODES = ['FULL', 'HYBRID', 'BAR'] as const;
export type SwipeMode = (typeof SWIPE_MODES)[number];

const PROGRAM_MODES = ['FULL', 'IDEATION'] as const;
export type ProgramMode = (typeof PROGRAM_MODES)[number];

function envEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[name] ?? '').trim().toUpperCase();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * UI configuration read from the environment at request time.
 * SWIPE_MODE: FULL (four-direction swipe + tap-to-expand), HYBRID
 * (horizontal swipe + scroll + action bar), or BAR (swipe navigates,
 * action bar decides).
 * PROGRAM_MODE: FULL (research/ideation/build) or IDEATION (the
 * "Build Now" action is hidden across the UI).
 * Invalid or unset values resolve to FULL.
 */
export async function GET() {
  return NextResponse.json({
    swipe_mode: envEnum('SWIPE_MODE', SWIPE_MODES, 'FULL'),
    program_mode: envEnum('PROGRAM_MODE', PROGRAM_MODES, 'FULL'),
  });
}
