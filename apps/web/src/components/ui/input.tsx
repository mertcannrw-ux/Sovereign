'use client';

import * as React from 'react';
import { cn } from '@app-builder/ui';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-lg border border-border bg-background-muted px-3.5 py-2 text-sm text-foreground shadow-[0_1px_0_rgba(255,255,255,.02)_inset] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-foreground-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/30 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-error focus-visible:ring-error/40',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
