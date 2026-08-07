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
          'flex min-h-[80px] w-full rounded-md border border-[#2A2A2A] bg-[#141414] px-3 py-2 text-sm text-[#ECECEC] placeholder:text-[#6B6B6B] read-only:cursor-default read-only:bg-[#1A1A1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10A37F]/30 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-[#EF4444] focus-visible:ring-[#EF4444]/50',
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
