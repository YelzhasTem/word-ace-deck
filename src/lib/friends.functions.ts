import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FriendUserInput = z.object({ userId: z.string().uuid() });
const FriendshipInput = z.object({ friendshipId: z.string().uuid() });

type DbError = { code?: string; message?: string };

export type FriendRpcRow = {
  friendship_id: string | null;
  status: string | null;
  relationship: "none" | "incoming" | "outgoing" | "friends";
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ExistingFriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
};

type IdRow = { id: string };

type QueryResult<T> = { data: T | null; error: DbError | null };

type QueryBuilder<T> = PromiseLike<QueryResult<T>> & {
  select(columns: string): QueryBuilder<T>;
  or(filter: string): QueryBuilder<T>;
  update(values: Record<string, unknown>): QueryBuilder<T>;
  eq(column: string, value: string): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
  insert(values: Record<string, unknown>): Promise<{ error: DbError | null }>;
  maybeSingle(): Promise<{ data: T | null; error: DbError | null }>;
};

type FriendSupabaseClient = {
  rpc<T>(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: T | null; error: DbError | null }>;
  from<T>(table: "friendships"): QueryBuilder<T>;
};

function friendDb(supabase: unknown) {
  return supabase as FriendSupabaseClient;
}

function friendErrorMessage(error: DbError | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "You already have a friend request with this user.";
  if (error.code === "23503") return "User not found.";
  return error.message || fallback;
}

export const listFriendships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await friendDb(context.supabase).rpc<FriendRpcRow[]>(
      "list_friendships",
    );
    if (error) throw new Error(error.message);
    return { friends: data ?? [] };
  });

export const searchFriendProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        query: z.string().trim().min(2).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: results, error } = await friendDb(context.supabase).rpc<FriendRpcRow[]>(
      "search_friend_profiles",
      {
        _query: data.query,
        _limit: 12,
      },
    );
    if (error) throw new Error(error.message);
    return { users: results ?? [] };
  });

export const sendFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FriendUserInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const db = friendDb(supabase);
    if (data.userId === userId) throw new Error("You cannot add yourself as a friend.");

    const pairFilter =
      `and(requester_id.eq.${userId},addressee_id.eq.${data.userId}),` +
      `and(requester_id.eq.${data.userId},addressee_id.eq.${userId})`;

    const { data: existing, error: existingError } = await db
      .from<ExistingFriendshipRow>("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(pairFilter)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    if (existing) {
      if (existing.status === "accepted") return { ok: true, status: "accepted" };
      if (existing.requester_id === userId) return { ok: true, status: "pending" };

      const { error: acceptError } = await db
        .from<ExistingFriendshipRow>("friendships")
        .update({ status: "accepted" })
        .eq("id", existing.id)
        .eq("addressee_id", userId);
      if (acceptError)
        throw new Error(friendErrorMessage(acceptError, "Could not accept request."));
      return { ok: true, status: "accepted" };
    }

    const { error } = await db.from<ExistingFriendshipRow>("friendships").insert({
      requester_id: userId,
      addressee_id: data.userId,
      status: "pending",
    });

    if (error) throw new Error(friendErrorMessage(error, "Could not send friend request."));
    return { ok: true, status: "pending" };
  });

export const acceptFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FriendshipInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await friendDb(context.supabase)
      .from<IdRow>("friendships")
      .update({ status: "accepted" })
      .eq("id", data.friendshipId)
      .eq("addressee_id", context.userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) throw new Error(friendErrorMessage(error, "Could not accept request."));
    if (!updated) throw new Error("Friend request not found.");
    return { ok: true };
  });

export const deleteFriendship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FriendshipInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await friendDb(context.supabase)
      .from<IdRow>("friendships")
      .delete()
      .eq("id", data.friendshipId)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(friendErrorMessage(error, "Could not update friendship."));
    if (!deleted) throw new Error("Friendship not found.");
    return { ok: true };
  });
