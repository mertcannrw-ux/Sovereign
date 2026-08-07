import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Narrow an unknown value to a plain object (the runtime shape of a JSON object).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * SSE endpoint that streams chat job status events.
 *
 * Events emitted:
 *   queued     — job created and waiting
 *   generating — AI provider is generating a response
 *   validating — generated output is being validated
 *   building   — validated changes are being applied (snapshot, files)
 *   ready      — job completed successfully
 *   failed     — job terminated with an error
 *
 * The client opens a single EventSource connection; the server polls the
 * BackgroundJob table every 2 seconds and pushes state transitions as
 * named SSE events.  The connection closes after a terminal event or
 * when the client disconnects.
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return new Response('Missing jobId parameter', { status: 400 });
  }

  const job = await getDb().backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return new Response('Job not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const POLL_INTERVAL_MS = 2000;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may have been closed; ignore.
        }
      };

      const closeStream = () => {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // ── Terminal states reached before the stream opened ──────
      if (job.status === 'SUCCEEDED') {
        sendEvent('ready', { jobId, status: 'ready', result: job.result });
        closeStream();
        return;
      }
      if (job.status === 'FAILED' || job.status === 'CANCELED') {
        sendEvent('failed', {
          jobId,
          status: 'failed',
          error: job.lastErrorCode,
          result: job.result,
        });
        closeStream();
        return;
      }

      // ── Still queued or running — start polling ───────────────
      sendEvent('queued', { jobId, status: 'queued' });

      let lastPhase: string | null = null;

      const poll = async (): Promise<void> => {
        if (request.signal.aborted) {
          closeStream();
          return;
        }
        // Wait for the poll interval, but abort early on disconnect.
        let abortHandler: (() => void) | undefined;
        const sleep = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, POLL_INTERVAL_MS);
          abortHandler = () => {
            clearTimeout(timer);
            resolve();
          };
          request.signal.addEventListener('abort', abortHandler, { once: true });
        });
        await sleep;
        if (abortHandler) {
          request.signal.removeEventListener('abort', abortHandler);
        }

        if (request.signal.aborted) {
          closeStream();
          return;
        }

        try {
          const current = await getDb().backgroundJob.findUnique({ where: { id: jobId } });
          if (!current) {
            sendEvent('failed', { error: 'Job not found' });
            closeStream();
            return;
          }

          // Extract the optional progress phase from the JSON result field.
          let phase: string | null = null;
          const rawResult = current.result;
          if (isRecord(rawResult)) {
            const rawPhase = rawResult.phase;
            if (typeof rawPhase === 'string') {
              phase = rawPhase;
            }
          }

          const currentStatus = current.status;

          if (currentStatus === 'RUNNING' && phase && phase !== lastPhase) {
            sendEvent(phase, { jobId, status: phase, result: current.result });
            lastPhase = phase;
          } else if (currentStatus === 'SUCCEEDED') {
            sendEvent('ready', { jobId, status: 'ready', result: current.result });
            closeStream();
            return;
          } else if (currentStatus === 'FAILED' || currentStatus === 'CANCELED') {
            sendEvent('failed', {
              jobId,
              status: 'failed',
              error: current.lastErrorCode,
              result: current.result,
            });
            closeStream();
            return;
          }
        } catch {
          sendEvent('failed', { error: 'Polling error' });
          closeStream();
          return;
        }

        // Schedule the next poll cycle.
        await poll();
      };

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
