'use client';

import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';
import { selectRealm } from '@/lib/use-current-realm';

/** Name a new shared Realm; on success it becomes the current Realm. */
export function CreateRealmDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (realmId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Keyed by open state so each opening starts from an empty form. */}
        {open && (
          <CreateRealmForm
            onCreated={(realmId) => {
              onOpenChange(false);
              onCreated?.(realmId);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateRealmForm({ onCreated }: { onCreated: (realmId: string) => void }) {
  const utils = trpc.useUtils();
  const createMutation = trpc.realms.create.useMutation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const realm = await createMutation.mutateAsync({ name: trimmed });
      await utils.realms.list.invalidate();
      selectRealm(realm.id);
      onCreated(realm.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the Realm.');
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Create a Realm</DialogTitle>
        <DialogDescription>
          A shared place where you, your people and Sovereign build from the same brief, keys and
          memory.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-6">
        <label htmlFor="realm-name" className="text-sm font-medium text-foreground">
          Name
        </label>
        <Input
          id="realm-name"
          autoFocus
          autoComplete="off"
          maxLength={100}
          placeholder="Acme Studio"
          value={name}
          error={error !== null}
          aria-describedby={error ? 'realm-name-error' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {error && (
          <p id="realm-name-error" role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
          {createMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Create Realm
        </Button>
      </DialogFooter>
    </form>
  );
}
