import type { GenerationEvent } from '@/lib/generation-stream';

/**
 * Serialize one SSE frame. The event name is pinned to the wire contract so a
 * producer cannot emit a frame the consumer's total `KNOWN_EVENT_TYPES` record
 * would silently drop.
 */
export function encodeEvent(event: GenerationEvent['type'], data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function messageRecord(message: {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  model: string;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp.toISOString(),
    model: message.model,
  };
}

export interface AsyncQueue<T> {
  push: (item: T) => void;
  end: () => void;
  fail: (err: unknown) => void;
  [Symbol.asyncIterator]: () => AsyncGenerator<T, void, unknown>;
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const queue: T[] = [];
  let resolveWaiter: (() => void) | null = null;
  let closed = false;
  let failure: unknown = null;

  return {
    push(item: T) {
      if (closed) return;
      queue.push(item);
      if (resolveWaiter) {
        const resolve = resolveWaiter;
        resolveWaiter = null;
        resolve();
      }
    },
    end() {
      if (closed) return;
      closed = true;
      if (resolveWaiter) {
        const resolve = resolveWaiter;
        resolveWaiter = null;
        resolve();
      }
    },
    fail(err: unknown) {
      if (closed) return;
      failure = err;
      closed = true;
      if (resolveWaiter) {
        const resolve = resolveWaiter;
        resolveWaiter = null;
        resolve();
      }
    },
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          while (queue.length > 0) {
            yield queue.shift()!;
          }
          if (closed) {
            if (failure) throw failure;
            return;
          }
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
        }
      } finally {
        closed = true;
      }
    },
  };
}
