import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Heart, Star, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { getCreatorProfile, toggleCreatorFollow } from "@/lib/community.functions";

export const Route = createFileRoute("/creator/$userId")({
  component: CreatorProfilePage,
});

type CreatorProfile = {
  userId: string;
  username: string;
  totalLearners: number;
  totalLikes: number;
  followers: number;
  followed: boolean;
};

type CreatorDeck = {
  id: string;
  title: string;
  description: string;
  category: string;
  cardCount: number;
  totalLearners: number;
  likes: number;
  rating: number;
};

function CreatorProfilePage() {
  const { userId } = Route.useParams();
  const loadProfile = useServerFn(getCreatorProfile);
  const followCreator = useServerFn(toggleCreatorFollow);
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [decks, setDecks] = useState<CreatorDeck[]>([]);

  useEffect(() => {
    loadProfile({ data: { userId } }).then((res) => {
      setProfile(res.profile as CreatorProfile);
      setDecks(res.decks as CreatorDeck[]);
    });
  }, [loadProfile, userId]);

  const onFollow = async () => {
    if (!profile) return;
    const res = await followCreator({ data: { creatorId: profile.userId } });
    setProfile({
      ...profile,
      followed: res.followed,
      followers: profile.followers + (res.followed ? 1 : -1),
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!profile ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Loading creator...</div>
        ) : (
          <>
            <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Creator Profile</p>
                  <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">{profile.username}</h1>
                </div>
                <Button className="rounded-full" onClick={onFollow}>
                  {profile.followed ? "Following" : "Follow creator"}
                </Button>
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-border bg-background px-4 py-3">
                  <p className="text-xs text-muted-foreground">Published decks</p>
                  <p className="font-display text-2xl">{decks.length}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background px-4 py-3">
                  <p className="text-xs text-muted-foreground">Total learners</p>
                  <p className="font-display text-2xl">{profile.totalLearners}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background px-4 py-3">
                  <p className="text-xs text-muted-foreground">Total likes</p>
                  <p className="font-display text-2xl">{profile.totalLikes}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background px-4 py-3">
                  <p className="text-xs text-muted-foreground">Followers</p>
                  <p className="font-display text-2xl">{profile.followers}</p>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="font-display text-2xl font-bold tracking-tight">Published decks</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {decks.map((deck) => (
                  <Link
                    key={deck.id}
                    to="/community/$deckId"
                    params={{ deckId: deck.id }}
                    className="rounded-2xl border border-border bg-card p-5 hover:border-primary transition-colors"
                  >
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">{deck.category}</span>
                    <h3 className="mt-3 font-display text-xl font-bold">{deck.title}</h3>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{deck.description}</p>
                    <div className="mt-4 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                      <span>{deck.cardCount} cards</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{deck.totalLearners}</span>
                      <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{deck.likes}</span>
                      <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" />{deck.rating || "New"}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
