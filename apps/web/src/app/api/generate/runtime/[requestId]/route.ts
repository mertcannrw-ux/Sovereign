import type { Prisma } from '@prisma-generated/prisma/client';
import { NextRequest } from 'next/server';
import { getVerifiedSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { coerceRuntimeResult, putRuntimeResult, RUNTIME_TRACE_PENDING } from '@/lib/runtime-bridge';
import { requireProjectRole } from '@/server/authz';

export const dynamic = 'force-dynamic';

/**
 * Client → server delivery of one `run` tool result.
 *
 * The generation stream is blocked in `waitForRuntimeResult` for this
 * `requestId`; this route validates that the caller owns the run and may edit
 * the project, persists the result on the `GenerationToolTrace` row (the only
 * state shared across server instances), and wakes the in-process waiter.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const session = await getVerifiedSession();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { requestId } = await context.params;
  if (!requestId) return Response.json({ error: 'Missing request id' }, { status: 400 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const result = coerceRuntimeResult(payload);
  if (!result) return Response.json({ error: 'Invalid runtime result' }, { status: 400 });

  const db = getDb();
  const trace = await db.generationToolTrace.findFirst({
    where: { requestId },
    select: { id: true, status: true, run: { select: { userId: true, projectId: true } } },
  });
  // All denials are 404: a request id from another run (or another user) must
  // not be distinguishable from one that never existed.
  if (!trace || trace.run.userId !== session.user.id) {
    return Response.json({ error: 'Runtime request not found' }, { status: 404 });
  }
  try {
    await requireProjectRole({ user: session.user, db }, trace.run.projectId, 'EDITOR');
  } catch {
    return Response.json({ error: 'Runtime request not found' }, { status: 404 });
  }
  if (trace.status !== RUNTIME_TRACE_PENDING) {
    // A duplicate POST for a request the waiter already consumed (or gave up
    // on): acknowledge so the client stops retrying.
    return Response.json({ ok: true, duplicate: true });
  }

  await db.generationToolTrace.update({
    where: { id: trace.id },
    data: {
      status: result.status,
      result: result as unknown as Prisma.InputJsonValue,
      durationMs: result.durationMs,
    },
  });
  putRuntimeResult(requestId, result);
  return Response.json({ ok: true });
}
