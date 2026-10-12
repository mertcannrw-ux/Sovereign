import { NextRequest } from 'next/server';
import { assertPlanAllowsMaxDuration } from '@/lib/agent-limits';
import { getVerifiedSession } from '@/lib/auth';
import { checkRateLimit } from '@/server/rate-limit';
import { createAgentStream, validateGeneratePayload, type GenerateBody } from '@/server/agent';

export const dynamic = 'force-dynamic';
/**
 * Longest a single generate stream may run. The agent loop has no step cap, so
 * wall clock is the only bound left: 800s is Vercel's generally available
 * maximum for Fluid functions (Pro/Enterprise). This must stay a numeric
 * literal — Next extracts it statically (SWC) and silently drops non-literal
 * values (compute-in-environment or `Math.min(...)`) back to the platform
 * default. Hobby's ceiling is 300s and the build fails at deploy time above
 * it, so `assertPlanAllowsMaxDuration` turns the misconfiguration into a
 * startup error with the exact fix instead of a confusing Vercel build error.
 * Truly unbounded runs need Vercel Workflows (durable execution), not a
 * longer function timeout.
 */
export const maxDuration = 800;
assertPlanAllowsMaxDuration(maxDuration);

/**
 * Authorize a project generation request and stream its progress and result as SSE.
 * Return HTTP errors for rejected requests and failed events for errors during generation.
 */
export async function POST(request: NextRequest) {
  const session = await getVerifiedSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateGeneratePayload(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const rate = await checkRateLimit('prompt', session.user.id);
  if (!rate.allowed) {
    const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return Response.json(
      { error: `Rate limit exceeded. Try again in ${retryIn}s.` },
      { status: 429 },
    );
  }

  const result = await createAgentStream({
    user: session.user,
    body: validation.data,
    runtimeEnabled: request.headers.get('x-sovereign-runtime') === '1',
    signal: request.signal,
  });

  if (!result.ok) {
    return Response.json(result.body, { status: result.status });
  }

  // Built explicitly rather than with `ReadableStream.from`: the static is not
  // declared by the DOM lib this app compiles against. `pull` reproduces what
  // `Stream.from` did — one generator yield per chunk, backpressure honoured —
  // and `cancel` reproduces its disconnect path, unwinding the generator where
  // the runner aborts in-flight provider calls and releases the generation
  // lease.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await result.generator.next();
      // The client may have hung up while this chunk was in flight: a closed or
      // errored stream is no longer readable and enqueue/close would throw.
      if (controller.desiredSize === null) return;
      if (chunk.done) controller.close();
      else controller.enqueue(chunk.value);
    },
    async cancel() {
      await result.generator.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
