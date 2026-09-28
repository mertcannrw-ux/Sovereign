'use client';

import * as React from 'react';
import { cn } from '@app-builder/ui';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-border bg-background-subtle px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted read-only:cursor-default read-only:bg-background-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-error focus-visible:ring-error',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
