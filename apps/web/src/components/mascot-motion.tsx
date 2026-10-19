'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';

/**
 * Applies the signed-in user's "Mascot animations" preference to the whole
 * app: when off, `data-mascot-motion="off"` on <html> gives every Logo and
 * Mascot the reduced-motion behaviour (see globals.css).
 */
export function MascotMotionPreference() {
  const { status } = useSession();
  const preferences = trpc.account.preferences.useQuery(undefined, {
    enabled: status === 'authenticated',
    staleTime: Infinity,
  });
  const off = status === 'authenticated' && preferences.data?.mascotAnimations === false;

  useEffect(() => {
    const root = document.documentElement;
    if (off) root.dataset.mascotMotion = 'off';
    else delete root.dataset.mascotMotion;
  }, [off]);

  return null;
}
