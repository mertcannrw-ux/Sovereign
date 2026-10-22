'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/trpc/client';

/**
 * Confirm leaving a shared Realm. The owner first chooses who owns it next;
 * an owner with nobody else in the Realm is sent to delete it instead.
 */
export function LeaveRealmDialog({
  open,
  onOpenChange,
  realmId,
  realmName,
  isOwner,
  others,
  onLeft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realmId: string;
  realmName: string;
  isOwner: boolean;
  /** Everyone else in the Realm, who could own it next. */
  others: { userId: string; name: string }[];
  onLeft: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted per opening so the choice and any error start fresh. */}
        {open && (
          <LeaveRealmForm
            realmId={realmId}
            realmName={realmName}
            isOwner={isOwner}
            others={others}
            onLeft={() => {
              onOpenChange(false);
              onLeft();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LeaveRealmForm({
  realmId,
  realmName,
  isOwner,
  others,
  onLeft,
}: {
  realmId: string;
  realmName: string;
  isOwner: boolean;
  others: { userId: string; name: string }[];
  onLeft: () => void;
}) {
  const utils = trpc.useUtils();
  const leave = trpc.realms.leave.useMutation({ meta: { inlineError: true } });
  const [newOwnerId, setNewOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const alone = isOwner && others.length === 0;

  async function submit() {
    setError(null);
    try {
      await leave.mutateAsync({ realmId, newOwnerId: isOwner ? newOwnerId : undefined });
      await utils.realms.list.invalidate();
      onLeft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave the Realm.');
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Leave {realmName}?</DialogTitle>
        <DialogDescription>
          {alone
            ? "You're the only one here. Delete the Realm in General instead."
            : isOwner
              ? 'You own this Realm. Choose who owns it after you leave.'
              : "You'll need a new invite to come back. Your projects stay here for everyone."}
        </DialogDescription>
      </DialogHeader>

      {isOwner && !alone && (
        <div className="pt-6">
          <Select value={newOwnerId} onValueChange={setNewOwnerId}>
            <SelectTrigger aria-label="New owner">
              <SelectValue placeholder="Choose the next owner" />
            </SelectTrigger>
            <SelectContent>
              {others.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && (
        <p role="alert" className="pt-4 text-sm text-error">
          {error}
        </p>
      )}

      <DialogFooter className="pt-6">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {alone ? 'Close' : 'Cancel'}
          </Button>
        </DialogClose>
        {!alone && (
          <Button
            variant="destructive"
            disabled={(isOwner && !newOwnerId) || leave.isPending}
            onClick={submit}
          >
            {leave.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Leave
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
