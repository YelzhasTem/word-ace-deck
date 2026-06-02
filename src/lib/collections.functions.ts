import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyCollections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [colRes, linkRes] = await Promise.all([
      supabase
        .from("collections")
        .select("id, name, description, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("collection_decks")
        .select("id, collection_id, deck_id, position")
        .eq("user_id", userId)
        .order("position", { ascending: true }),
    ]);
    if (colRes.error) throw new Error(colRes.error.message);
    if (linkRes.error) throw new Error(linkRes.error.message);
    return { collections: colRes.data ?? [], links: linkRes.data ?? [] };
  });

export const createCollectionRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(300).default(""),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: col, error } = await supabase
      .from("collections")
      .insert({ user_id: userId, name: data.name, description: data.description })
      .select("id")
      .single();
    if (error || !col) throw new Error(error?.message ?? "Не удалось создать коллекцию");
    return { id: col.id };
  });

export const deleteCollectionRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("collections").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setCollectionDecksRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      collectionId: z.string().uuid(),
      deckIds: z.array(z.string().uuid()).max(500),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error: delErr } = await supabase
      .from("collection_decks")
      .delete()
      .eq("collection_id", data.collectionId)
      .eq("user_id", userId);
    if (delErr) throw new Error(delErr.message);
    if (data.deckIds.length > 0) {
      const { error: insErr } = await supabase.from("collection_decks").insert(
        data.deckIds.map((deck_id, position) => ({
          collection_id: data.collectionId,
          deck_id,
          user_id: userId,
          position,
        })),
      );
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });
