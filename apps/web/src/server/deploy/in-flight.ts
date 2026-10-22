import type { Prisma } from '@prisma-generated/prisma/client';

/** A deploy still DEPLOYING after this long is treated as dead, not running. */
export const DEPLOY_IN_FLIGHT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Count the project's running deploys. Call under `lockRealm`.
 *
 * Deploys stuck past the window are marked FAILED first. Skipping them without
 * that left their row DEPLOYING, so a deploy that finally finished after an
 * unpublish still passed its own re-check and put the app back online.
 */
export async function countInFlightDeployments(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - DEPLOY_IN_FLIGHT_WINDOW_MS);
  await tx.deployment.updateMany({
    where: { projectId, status: 'DEPLOYING', createdAt: { lt: cutoff } },
    data: { status: 'FAILED', buildLogs: 'Deploy did not finish in time.\n' },
  });
  return tx.deployment.count({
    where: { projectId, status: 'DEPLOYING', createdAt: { gte: cutoff } },
  });
}
