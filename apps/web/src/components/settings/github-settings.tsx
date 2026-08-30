'use client';

import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GitBranch, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

interface GitHubSettingsProps {
  className?: string;
}

export function GitHubSettings({ className }: GitHubSettingsProps) {
  const statusQuery = trpc.github.status.useQuery();
  const disconnect = trpc.github.disconnect.useMutation({
    onSuccess: () => statusQuery.refetch(),
  });
  const connection = statusQuery.data;

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          GitHub Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-lg border border-border bg-background-subtle px-3.5 py-3 text-sm text-foreground-muted">
          Repository export and GitHub App install are not wired yet. This panel only
          reports whether a GitHub OAuth account is linked for sign-in.
        </p>
        <div className="flex items-center justify-between rounded-lg border border-border bg-background-subtle p-4">
          <div className="flex items-center gap-3">
            {statusQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
            ) : connection?.connected ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <XCircle className="h-5 w-5 text-foreground-muted" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {connection?.connected ? `Linked as ${connection.username}` : 'Not connected'}
              </p>
              <p className="text-xs text-foreground-muted">
                {connection?.connected
                  ? `Scope: ${connection.scope ?? 'N/A'}`
                  : 'Connect GitHub from the sign-in page when OAuth is configured.'}
              </p>
            </div>
          </div>
          {connection?.connected && (
            <Button
              variant="outline"
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
