import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma-generated/prisma/client';
import { DEPLOY_IN_FLIGHT_WINDOW_MS, countInFlightDeployments } from './in-flight';

function fakeTx(count: number) {
  const tx = {
    deployment: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(count),
    },
  };
  return tx as typeof tx & Prisma.TransactionClient;
}

describe('countInFlightDeployments', () => {
  it('fails stuck deploys before counting the running ones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const cutoff = new Date(Date.now() - DEPLOY_IN_FLIGHT_WINDOW_MS);
    const tx = fakeTx(1);

    await expect(countInFlightDeployments(tx, 'proj-1')).resolves.toBe(1);

    expect(tx.deployment.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', status: 'DEPLOYING', createdAt: { lt: cutoff } },
      data: { status: 'FAILED', buildLogs: 'Deploy did not finish in time.\n' },
    });
    expect(tx.deployment.count).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', status: 'DEPLOYING', createdAt: { gte: cutoff } },
    });
    expect(tx.deployment.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.deployment.count.mock.invocationCallOrder[0]!,
    );
    vi.useRealTimers();
  });
});
