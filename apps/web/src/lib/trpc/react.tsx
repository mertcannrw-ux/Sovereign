'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, TRPCClientError } from '@trpc/client';
import toast from 'react-hot-toast';
import superjson from 'superjson';
import { trpc } from './client';

function getErrorMessage(error: unknown): string {
  if (error instanceof TRPCClientError) {
    return error.message || 'Something went wrong. Please try again.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function makeQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  // Surface failures instead of failing silently. Without this, a rejected
  // mutation (e.g. creating a project) left the UI unchanged and said nothing:
  // there was no error link, no toast call site, and query errors were never
  // read. De-duplicated per message so a refetching query cannot spam the UI.
  const notify = (error: unknown) => {
    toast.error(getErrorMessage(error), { id: `trpc-error:${getErrorMessage(error)}` });
  };
  queryClient.getQueryCache().config.onError = notify;
  queryClient.getMutationCache().config.onError = notify;

  return queryClient;
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </trpc.Provider>
    </QueryClientProvider>
  );
}
