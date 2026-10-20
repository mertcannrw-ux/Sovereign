'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { RealmRole } from '@app-builder/shared';

const STORAGE_KEY = 'sovereign:realm';
const CHANGE_EVENT = 'sovereign:realm-changed';

// Holds the choice when localStorage is blocked, so switching still works.
let memoryChoice: string | null = null;

function readChoice(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryChoice;
  } catch {
    return memoryChoice;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Make `realmId` the current Realm everywhere: projects, keys, settings. */
export function selectRealm(realmId: string) {
  memoryChoice = realmId;
  try {
    window.localStorage.setItem(STORAGE_KEY, realmId);
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Owner and Admin manage a Realm's members, keys, brief, memory and rules. */
export function canManageRealm(role: RealmRole | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * The Realm the user is working in. Falls back to their personal Realm when
 * nothing was chosen yet or the chosen one is gone (they left or were removed).
 */
export function useCurrentRealm() {
  const realmsQuery = trpc.realms.list.useQuery();
  const chosenId = useSyncExternalStore(subscribe, readChoice, () => null);
  const realms = realmsQuery.data ?? [];
  const realm =
    realms.find((candidate) => candidate.id === chosenId) ??
    realms.find((candidate) => candidate.type === 'PERSONAL') ??
    realms[0] ??
    null;

  const select = useCallback((realmId: string) => selectRealm(realmId), []);

  return {
    realm,
    realms,
    isLoading: realmsQuery.isLoading,
    error: realmsQuery.error,
    refetch: realmsQuery.refetch,
    selectRealm: select,
  };
}
