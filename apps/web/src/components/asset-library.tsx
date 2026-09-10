import { useState } from 'react';
import { Copy, Check, Trash2, Image as ImageIcon, Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/trpc/client';

interface AssetLibraryProps {
  projectId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetLibrary({ projectId }: AssetLibraryProps) {
  const assetsQuery = trpc.assets.list.useQuery({ projectId });
  const deleteMutation = trpc.assets.delete.useMutation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const assets = assetsQuery.data ?? [];
  const filteredAssets = assets.filter((asset) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      asset.publicUrl.toLowerCase().includes(q) ||
      (asset.prompt && asset.prompt.toLowerCase().includes(q)) ||
      asset.mediaType.toLowerCase().includes(q)
    );
  });

  const handleCopyUrl = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMutation.mutateAsync({ assetId: id, projectId });
      await assetsQuery.refetch();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-background-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Project Assets</h2>
          <Badge variant="outline" className="text-[10px]">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
            <Input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => assetsQuery.refetch()}
            disabled={assetsQuery.isFetching}
          >
            <RefreshCw
              className={assetsQuery.isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
            />
          </Button>
        </div>
      </div>

      {/* Main Asset Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {assetsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
          </div>
        ) : assetsQuery.isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-foreground-muted">
            <ImageIcon className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">Failed to load assets</p>
            <p className="mt-1 text-xs">A network or server error occurred.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => assetsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-foreground-muted">
            <ImageIcon className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">No assets found</p>
            <p className="mt-1 text-xs">
              {searchQuery
                ? 'Try another search query'
                : 'Generated images and uploads will appear here.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAssets.map((asset) => {
              const isCopied = copiedId === asset.id;
              const isDeleting = deletingId === asset.id;

              return (
                <Card
                  key={asset.id}
                  className="group relative overflow-hidden border-border bg-background-subtle transition-all hover:border-border-strong"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-background-muted">
                    <img
                      src={asset.publicUrl}
                      alt={asset.prompt ?? 'Project Asset'}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                    <Badge
                      variant="outline"
                      className="absolute left-2 top-2 bg-background/80 text-[10px] backdrop-blur-sm"
                    >
                      {asset.source}
                    </Badge>
                  </div>
                  <CardContent className="space-y-2 p-3">
                    {asset.prompt && (
                      <p className="line-clamp-2 text-xs text-foreground" title={asset.prompt}>
                        {asset.prompt}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-foreground-muted">
                      <span>{formatBytes(asset.byteSize)}</span>
                      <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-xs"
                        onClick={() => handleCopyUrl(asset.id, asset.publicUrl)}
                      >
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {isCopied ? 'Copied' : 'Copy URL'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={isDeleting}
                        onClick={() => handleDelete(asset.id)}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-error" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
