import { useServerFn } from "@tanstack/react-start";
import { Ban, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBlockedUsers, unblockUser } from "@/lib/safety.functions";

type BlockedUser = { userId: string; name: string };

export function BlockedUsersCard() {
  const loadBlocked = useServerFn(getBlockedUsers);
  const unblock = useServerFn(unblockUser);
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    loadBlocked()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
  }, [loadBlocked]);

  const onUnblock = async (user: BlockedUser) => {
    setPending(user.userId);
    try {
      await unblock({ data: { userId: user.userId } });
      setUsers((prev) => (prev ?? []).filter((item) => item.userId !== user.userId));
      toast.success(`${user.name} is unblocked.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unblock this user.");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Ban className="h-5 w-5 text-muted-foreground" /> Blocked users
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You do not see content from people you block, and they cannot send you friend requests.
      </p>
      {users === null ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </p>
      ) : users.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">You have not blocked anyone.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {users.map((user) => (
            <li key={user.userId} className="flex items-center justify-between gap-3 py-3">
              <span className="truncate font-medium">{user.name}</span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => onUnblock(user)}
                disabled={pending === user.userId}
              >
                {pending === user.userId && <Loader2 className="h-4 w-4 animate-spin" />}
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
