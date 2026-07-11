import { NextResponse } from 'next/server';
import { getHealthDetail } from '@/lib/health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Fully gated by the auth middleware (session cookie or bearer token) like
 * every other API route — always returns the full detail payload.
 */
export async function GET() {
  try {
    return NextResponse.json(getHealthDetail());
  } catch (error) {
    return NextResponse.json(
      { error: 'Health check failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
