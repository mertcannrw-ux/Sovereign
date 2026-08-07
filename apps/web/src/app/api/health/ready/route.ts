import { NextResponse } from 'next/server';

interface HealthCheck {
  name: string;
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { getDb } = await import('@/lib/db');
    const database = getDb();
    await database.$queryRaw`SELECT 1`;
    return { name: 'database', status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    return {
      name: 'database',
      status: 'error',
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
  if (!url) {
    return { name: 'redis', status: 'ok', latencyMs: 0, error: 'Not configured (skipped)' };
  }
  try {
    // Lightweight TCP connect check
    const { URL } = globalThis;
    const parsed = new URL(url);
    const net = await import('net');
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(
        { host: parsed.hostname, port: Number(parsed.port) || 6379 },
        () => {
          socket.destroy();
          resolve();
        },
      );
      socket.setTimeout(3000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
      socket.on('error', reject);
    });
    return { name: 'redis', status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    return {
      name: 'redis',
      status: 'error',
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

async function checkObjectStorage(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.R2_ACCESS_KEY_ID) {
    return {
      name: 'object-storage',
      status: 'ok',
      latencyMs: 0,
      error: 'Not configured (skipped)',
    };
  }
  // R2/S3 availability check — just verify credentials are present for now.
  // Full bucket probe is too expensive for a readiness check.
  return { name: 'object-storage', status: 'ok', latencyMs: Date.now() - start };
}

/**
 * Readiness probe — returns 200 if critical dependencies are reachable.
 * Never tests paid external providers (E2B, Stripe, Vercel, etc.).
 */
export async function GET() {
  const checks = await Promise.all([checkDatabase(), checkRedis(), checkObjectStorage()]);
  const allOk = checks.every((c) => c.status === 'ok');

  return NextResponse.json(
    {
      status: allOk ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 },
  );
}
