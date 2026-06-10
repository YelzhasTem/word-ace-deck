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
  updateCollectionPublishingRecord,
  updateCollectionRecord,
} from "@/lib/collections.functions";

export type Collection = {
  id: string;
  name: string;
  description: string;
  deckIds: string[];
  createdAt: number;
  visibility: "private" | "unlisted" | "public";
  keywords: string[];
  totalLearners: number;
  likes: number;
  rating: number;
  copies: number;
  publishedAt: string | null;
};

const KEY = ["my-collections"] as const;
const DEFAULT_COLLECTION_NAME = "My collection";
const LEGACY_DEFAULT_COLLECTION_NAME =
  "\u041c\u043e\u044f \u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\u044f";

function displayCollectionName(name: string) {
  return name === LEGACY_DEFAULT_COLLECTION_NAME ? DEFAULT_COLLECTION_NAME : name;
}

export function useCollections() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMyCollections);
  const createFn = useServerFn(createCollectionRecord);
  const deleteFn = useServerFn(deleteCollectionRecord);
  const setDecksFn = useServerFn(setCollectionDecksRecord);
  const updateCollectionFn = useServerFn(updateCollectionRecord);
  const updatePublishingFn = useServerFn(updateCollectionPublishingRecord);

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
        name: displayCollectionName(c.name),
        description: c.description ?? "",
        deckIds: linksByCol.get(c.id) ?? [],
        createdAt: new Date(c.created_at).getTime(),
        visibility: c.visibility ?? "private",
        keywords: c.keywords ?? [],
        totalLearners: c.learner_count ?? 0,
        likes: c.like_count ?? 0,
        rating: c.rating_count ? Number(((c.rating_sum ?? 0) / c.rating_count).toFixed(1)) : 0,
        copies: c.copy_count ?? 0,
        publishedAt: c.published_at ?? null,
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
    toast.error(`${msg}: ${e instanceof Error ? e.message : "error"}`);

  const createMut = useMutation({
    mutationFn: (vars: { name: string; description: string }) => createFn({ data: vars }),
    onSuccess: () => {
      toast.success("Collection created");
      invalidate();
    },
    onError: onErr("Could not create collection"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onErr("Could not delete"),
  });

  const setDecksMut = useMutation({
    mutationFn: (vars: { collectionId: string; deckIds: string[] }) => setDecksFn({ data: vars }),
    onSuccess: () => {
      toast.success("Decks saved");
      invalidate();
    },
    onError: onErr("Could not save"),
  });

  const updateCollectionMut = useMutation({
    mutationFn: (vars: { id: string; name: string; description: string }) =>
      updateCollectionFn({ data: vars }),
    onSuccess: () => {
      toast.success("Collection updated");
      invalidate();
    },
    onError: onErr("Could not update collection"),
  });

  const updatePublishingMut = useMutation({
    mutationFn: (vars: {
      collectionId: string;
      visibility: "private" | "unlisted" | "public";
      keywords: string[];
    }) => updatePublishingFn({ data: vars }),
    onSuccess: () => {
      toast.success("Collection visibility updated");
      invalidate();
    },
    onError: onErr("Could not update publishing"),
  });

  return {
    collections: query.data ?? [],
    isLoading: query.isLoading,
    createCollection: (name: string, description: string) =>
      createMut.mutate({ name, description }),
    deleteCollection: (id: string) => deleteMut.mutate(id),
    updateCollection: (id: string, name: string, description: string) =>
      updateCollectionMut.mutate({ id, name, description }),
    setCollectionDecks: (collectionId: string, deckIds: string[]) =>
      setDecksMut.mutate({ collectionId, deckIds }),
    updateCollectionPublishing: (
      collectionId: string,
      visibility: "private" | "unlisted" | "public",
      keywords: string[],
    ) => updatePublishingMut.mutateAsync({ collectionId, visibility, keywords }),
  };
}

export function useCollection(id: string) {
  const { collections, ...rest } = useCollections();
  const collection = useMemo(() => collections.find((c) => c.id === id), [collections, id]);
  return { collection, ...rest };
}
