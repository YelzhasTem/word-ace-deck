import { useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createCollectionRecord,
  deleteCollectionRecord,
  getMyCollections,
  setCollectionDecksRecord,
} from "@/lib/collections.functions";

export type Collection = {
  id: string;
  name: string;
  description: string;
  deckIds: string[];
  createdAt: number;
};

const KEY = ["my-collections"] as const;

export function useCollections() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMyCollections);
  const createFn = useServerFn(createCollectionRecord);
  const deleteFn = useServerFn(deleteCollectionRecord);
  const setDecksFn = useServerFn(setCollectionDecksRecord);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetchFn();
      const linksByCol = new Map<string, string[]>();
      res.links.forEach((l) => {
        const arr = linksByCol.get(l.collection_id) ?? [];
        arr.push(l.deck_id);
        linksByCol.set(l.collection_id, arr);
      });
      return res.collections.map<Collection>((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        deckIds: linksByCol.get(c.id) ?? [],
        createdAt: new Date(c.created_at).getTime(),
      }));
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        qc.invalidateQueries({ queryKey: KEY });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const onErr = (msg: string) => (e: unknown) =>
    toast.error(`${msg}: ${e instanceof Error ? e.message : "ошибка"}`);

  const createMut = useMutation({
    mutationFn: (vars: { name: string; description: string }) => createFn({ data: vars }),
    onSuccess: () => {
      toast.success("Коллекция создана");
      invalidate();
    },
    onError: onErr("Не удалось создать коллекцию"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onErr("Не удалось удалить"),
  });

  const setDecksMut = useMutation({
    mutationFn: (vars: { collectionId: string; deckIds: string[] }) =>
      setDecksFn({ data: vars }),
    onSuccess: () => {
      toast.success("Колоды сохранены");
      invalidate();
    },
    onError: onErr("Не удалось сохранить"),
  });

  return {
    collections: query.data ?? [],
    isLoading: query.isLoading,
    createCollection: (name: string, description: string) =>
      createMut.mutate({ name, description }),
    deleteCollection: (id: string) => deleteMut.mutate(id),
    setCollectionDecks: (collectionId: string, deckIds: string[]) =>
      setDecksMut.mutate({ collectionId, deckIds }),
  };
}

export function useCollection(id: string) {
  const { collections, ...rest } = useCollections();
  const collection = useMemo(() => collections.find((c) => c.id === id), [collections, id]);
  return { collection, ...rest };
}
