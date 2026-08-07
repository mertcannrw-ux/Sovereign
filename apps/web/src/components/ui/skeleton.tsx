'use client';

import * as React from 'react';
import { cn } from '@app-builder/ui';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-[#1A1A1A]', className)} {...props} />;
}

export { Skeleton };
