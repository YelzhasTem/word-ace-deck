import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type DeleteBuilder = {
  delete(): DeleteBuilder;
  eq(column: string, value: string): DeleteBuilder;
  or(filter: string): DeleteBuilder;
  select(columns: string): DeleteBuilder;
  maybeSingle(): Promise<{ data: unknown | null; error: { message?: string } | null }>;
  then: Promise<{ error: { message?: string } | null }>["then"];
};

type AdminDb = {
  from(table: string): DeleteBuilder;
};

async function deleteWhere(table: string, column: string, userId: string) {
  const { error } = await (supabaseAdmin as unknown as AdminDb)
    .from(table)
    .delete()
    .eq(column, userId);

  if (error) throw new Error(error.message || `Could not delete ${table}.`);
}

async function deleteWhereEither(
  table: string,
  firstColumn: string,
  secondColumn: string,
  userId: string,
) {
  const { error } = await (supabaseAdmin as unknown as AdminDb)
    .from(table)
    .delete()
    .or(`${firstColumn}.eq.${userId},${secondColumn}.eq.${userId}`);

  if (error) throw new Error(error.message || `Could not delete ${table}.`);
}

async function deleteAvatarFiles(userId: string) {
  const bucket = supabaseAdmin.storage.from("avatars");
  const { data, error } = await bucket.list(userId, { limit: 100 });

  if (error || !data?.length) return;

  const paths = data.map((file) => `${userId}/${file.name}`);
  await bucket.remove(paths);
}

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;

    const { error: userCheckError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userCheckError) {
      throw new Error(userCheckError.message || "Could not verify account before deletion.");
    }

    await deleteAvatarFiles(userId);

    await deleteWhereEither("friendships", "requester_id", "addressee_id", userId);
    await deleteWhereEither("creator_follows", "creator_id", "follower_id", userId);

    await deleteWhere("deck_likes", "user_id", userId);
    await deleteWhere("deck_saves", "user_id", userId);
    await deleteWhere("deck_ratings", "user_id", userId);
    await deleteWhere("deck_reports", "reporter_id", userId);

    await deleteWhere("collection_likes", "user_id", userId);
    await deleteWhere("collection_saves", "user_id", userId);
    await deleteWhere("collection_ratings", "user_id", userId);
    await deleteWhere("collection_reports", "reporter_id", userId);

    await deleteWhere("collection_decks", "user_id", userId);
    await deleteWhere("cards", "user_id", userId);
    await deleteWhere("collections", "user_id", userId);
    await deleteWhere("decks", "user_id", userId);
    await deleteWhere("streak_days", "user_id", userId);
    await deleteWhere("user_roles", "user_id", userId);
    await deleteWhere("profiles", "user_id", userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message || "Could not delete account.");

    return { ok: true };
  });
