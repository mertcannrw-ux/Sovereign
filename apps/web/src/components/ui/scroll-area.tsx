// ScrollArea component — scrollable container with custom scrollbar
'use client';

import { forwardRef } from 'react';
import { cn } from '@app-builder/ui/utils';

const ScrollArea = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'overflow-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:hover:bg-border-strong [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
