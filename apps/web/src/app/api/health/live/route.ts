import { NextResponse } from 'next/server';

/**
 * Liveness probe — returns 200 if the process is running.
 * No external dependencies checked.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
