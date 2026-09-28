'use client';

import * as React from 'react';
import { cn } from '@app-builder/ui';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-background-muted', className)} {...props} />;
}

export { Skeleton };
