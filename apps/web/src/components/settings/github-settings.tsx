'use client';

import { useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  GitBranch,
  Link2,
  Unlink,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
} from 'lucide-react';

interface GitHubSettingsProps {
  className?: string;
}

export function GitHubSettings({ className }: GitHubSettingsProps) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [repoName, setRepoName] = useState('');
  const [repoDescription, setRepoDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [showExportForm, setShowExportForm] = useState(false);

  // ── Mock state (tRPC pending) ────────────────────────
  const connection = null as { connected: boolean; username?: string; scope?: string } | null;
  const statusLoading = false;
  const isConnecting = false;
  const isDisconnecting = false;
  const isExporting = false;

  function handleConnect() {
    // Mock — will use tRPC when wired
  }

  function handleDisconnect() {
    // Mock — tRPC pending
  }

  function handleExport() {
    // Mock — tRPC pending
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          GitHub Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection status */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-background-subtle p-4">
          <div className="flex items-center gap-3">
            {statusLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
            ) : connection?.connected ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <XCircle className="h-5 w-5 text-foreground-muted" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {connection?.connected ? `Connected as ${connection.username}` : 'Not connected'}
              </p>
              <p className="text-xs text-foreground-muted">
                {connection?.connected
                  ? `Scope: ${connection.scope ?? 'N/A'}`
                  : 'Connect your GitHub account to export projects'}
              </p>
            </div>
          </div>

          {connection?.connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="mr-1.5 h-4 w-4" />
              )}
              Disconnect
            </Button>
          ) : null}
        </div>

        {/* Connect form (shown when not connected) */}
        {!connection?.connected ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h4 className="text-sm font-medium text-foreground">Connect GitHub Account</h4>
            <p className="text-xs text-foreground-muted">
              Enter a GitHub personal access token (classic) with{' '}
              <code className="rounded bg-background-muted px-1 py-0.5 font-mono text-xs">
                repo
              </code>{' '}
              and{' '}
              <code className="rounded bg-background-muted px-1 py-0.5 font-mono text-xs">
                user
              </code>{' '}
              scopes.
            </p>
            <div className="space-y-2">
              <Input
                placeholder="GitHub personal access token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
              />
              <Input
                placeholder="GitHub username (optional)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <Button onClick={handleConnect} disabled={!token.trim() || isConnecting} size="sm">
              {isConnecting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-1.5 h-4 w-4" />
              )}
              Connect
            </Button>
          </div>
        ) : null}

        {/* Export form (shown when connected) */}
        {connection?.connected ? (
          <>
            <Separator />
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExportForm(!showExportForm)}
                className="mb-3"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Export Project to GitHub
              </Button>

              {showExportForm ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <h4 className="text-sm font-medium text-foreground">Create GitHub Repository</h4>
                  <div className="space-y-2">
                    <Input
                      placeholder="Repository name (e.g., my-project)"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                    />
                    <Input
                      placeholder="Description (optional)"
                      value={repoDescription}
                      onChange={(e) => setRepoDescription(e.target.value)}
                    />
                    <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="rounded border-border"
                      />
                      Private repository
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleExport}
                      disabled={!repoName.trim() || isExporting}
                      size="sm"
                    >
                      {isExporting ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-1.5 h-4 w-4" />
                      )}
                      Export
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowExportForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
