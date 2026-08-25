import { useState } from 'react';
import { Sparkles, Check, RefreshCw, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@app-builder/ui/utils';
import type { DesignDirectionsEventData } from '@/lib/generation-stream';

interface DesignDirectionCardsProps {
  data: DesignDirectionsEventData;
  onSelect: (directionId: string) => Promise<void>;
  onSkip: () => Promise<void>;
  onRegenerate?: () => Promise<void>;
  isSubmitting?: boolean;
}

export function DesignDirectionCards({
  data,
  onSelect,
  onSkip,
  onRegenerate,
  isSubmitting = false,
}: DesignDirectionCardsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isResolved = data.status === 'selected' || data.status === 'skipped';

  return (
    <div className="my-4 space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Choose a Visual Direction</h3>
        </div>
        <span className="text-xs text-foreground-muted">3 Concepts</span>
      </div>

      <p className="text-xs text-foreground-muted">
        Review the visual rationale, palette, typography, and preview composition for each concept. Select your preferred direction to proceed with full application generation.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {data.directions.map((dir, index) => {
          const isSelected = selectedId === dir.id;
          const paletteObj = (dir.palette && typeof dir.palette === 'object' ? dir.palette : {}) as Record<string, string>;
          const typographyObj = (dir.typography && typeof dir.typography === 'object' ? dir.typography : {}) as Record<string, string>;

          return (
            <Card
              key={dir.id || index}
              className={cn(
                'relative flex flex-col justify-between border-border bg-background transition-all hover:border-primary/50',
                isSelected && 'border-primary ring-2 ring-primary/20',
              )}
            >
              <CardContent className="flex flex-col p-3 space-y-3">
                {/* Hero Image Preview */}
                <div className="relative h-32 w-full overflow-hidden rounded-lg bg-background-muted">
                  {dir.previewAsset?.publicUrl ? (
                    <img
                      src={dir.previewAsset.publicUrl}
                      alt={dir.title}
                      className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                    />
                  ) : dir.status === 'generating' ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-foreground-muted">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="text-[10px]">Generating preview...</span>
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-foreground-muted">
                      {dir.errorMessage ?? 'Preview unavailable'}
                    </div>
                  )}
                  <Badge
                    variant="outline"
                    className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm text-[10px]"
                  >
                    Option {index + 1}
                  </Badge>
                </div>

                {/* Title & Brief */}
                <div>
                  <h4 className="font-semibold text-sm text-foreground">{dir.title}</h4>
                  <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-foreground-muted">
                    {dir.visualBrief}
                  </p>
                </div>

                {/* Palette */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider">
                    Palette
                  </span>
                  <div className="flex items-center gap-1.5">
                    {['primary', 'secondary', 'background', 'accent'].map((key) => {
                      const color = paletteObj[key];
                      if (!color) return null;
                      return (
                        <div
                          key={key}
                          className="h-4 w-4 rounded-full border border-border shadow-xs"
                          style={{ backgroundColor: color }}
                          title={`${key}: ${color}`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Typography */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider">
                    Typography
                  </span>
                  <div className="flex flex-wrap gap-1 text-[10px] text-foreground-secondary">
                    {typographyObj.headingFont && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        {typographyObj.headingFont}
                      </Badge>
                    )}
                    {typographyObj.bodyFont && typographyObj.bodyFont !== typographyObj.headingFont && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        {typographyObj.bodyFont}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Select Action */}
                <Button
                  size="sm"
                  className="w-full mt-2 gap-1.5"
                  disabled={isResolved || isSubmitting}
                  onClick={async () => {
                    setSelectedId(dir.id);
                    await onSelect(dir.id);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  Select Direction
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs">
        <Button
          variant="ghost"
          size="sm"
          disabled={isResolved || isSubmitting}
          onClick={onSkip}
          className="gap-1.5 text-foreground-muted hover:text-foreground"
        >
          Let Sovereign choose default
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>

        {onRegenerate && (
          <Button
            variant="outline"
            size="sm"
            disabled={isResolved || isSubmitting}
            onClick={onRegenerate}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate Concepts
          </Button>
        )}
      </div>
    </div>
  );
}
