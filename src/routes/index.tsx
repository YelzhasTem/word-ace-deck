import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useDecks } from "@/lib/decks";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Sparkles, Trash2, BookOpen } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Лингвокарточки — учим английские слова" },
      { name: "description", content: "Создавайте свои колоды и учите английские слова по карточкам." },
    ],
  }),
  component: Home,
});

// Helper for Russian noun pluralization
function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function Home() {
  const { decks, createDeck, deleteDeck } = useDecks();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createDeck(name.trim(), desc.trim());
    setName("");
    setDesc("");
    setOpen(false);
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-14">
        {/* Hero */}
        <section className="grid md:grid-cols-[1.4fr_1fr] gap-10 items-end mb-16">
          <div>
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground mb-4">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Тихий способ запоминать
            </p>
            <h1 className="font-display text-5xl md:text-7xl font-semibold leading-[0.95] tracking-tight">
              Английский —
              <br />
              по одной <span className="italic text-accent">карточке</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Собирайте свои колоды слов, листайте их в своём ритме, а то, что уже знаете,
              пусть спокойно уходит из повторений.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="lg" className="rounded-full px-6 h-12 text-base">
                    <Plus className="h-4 w-4" /> Новая колода
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="font-display text-2xl">Создать колоду</DialogTitle>
                    <DialogDescription>
                      Дайте ей название. Карточки добавите на следующем шаге.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Название</label>
                      <Input
                        autoFocus
                        placeholder="Например: IELTS — Speaking"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Описание (необязательно)</label>
                      <Textarea
                        placeholder="О чём эта колода?"
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
                    <Button onClick={handleCreate}>Создать</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {decks[0] && (
                <Button asChild size="lg" variant="outline" className="rounded-full px-6 h-12 text-base">
                  <Link to="/study/$deckId" params={{ deckId: decks[0].id }}>
                    <BookOpen className="h-4 w-4" /> Продолжить учить
                  </Link>
                </Button>
              )}
            </div>
          </div>

          <div className="relative hidden md:block">
            <div className="absolute inset-0 -rotate-6 rounded-3xl bg-accent/30" />
            <div className="absolute inset-0 rotate-3 rounded-3xl bg-card border border-border shadow-xl" />
            <div className="relative rounded-3xl bg-card border border-border p-8 shadow-2xl">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">сущ.</p>
              <p className="font-display text-4xl font-semibold mt-2">serendipity</p>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Счастливая случайность; способность находить хорошее без поиска.
              </p>
              <div className="mt-6 flex gap-2 flex-wrap">
                <span className="text-xs px-2 py-1 rounded-full bg-secondary">/ˌserənˈdɪpɪti/</span>
                <span className="text-xs px-2 py-1 rounded-full bg-secondary">уровень C1</span>
              </div>
            </div>
          </div>
        </section>

        {/* Decks */}
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-display text-3xl font-semibold">Ваши колоды</h2>
            <span className="text-sm text-muted-foreground">
              {decks.length} {plural(decks.length, ["колода", "колоды", "колод"])}
            </span>
          </div>

          {decks.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-16 text-center">
              <p className="text-muted-foreground">Пока нет колод. Создайте первую выше.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {decks.map((deck) => {
                const known = deck.cards.filter((c) => c.known).length;
                const total = deck.cards.length;
                const pct = total ? Math.round((known / total) * 100) : 0;
                return (
                  <div
                    key={deck.id}
                    className="group relative rounded-3xl bg-card border border-border p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all"
                  >
                    <Link
                      to="/deck/$deckId"
                      params={{ deckId: deck.id }}
                      className="block"
                    >
                      <h3 className="font-display text-2xl font-semibold leading-tight">{deck.name}</h3>
                      {deck.description && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{deck.description}</p>
                      )}

                      <div className="mt-6">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                          <span>
                            {total} {plural(total, ["карточка", "карточки", "карточек"])}
                          </span>
                          <span>выучено {pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full bg-accent transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </Link>

                    <div className="mt-5 flex items-center justify-between">
                      <Link
                        to="/study/$deckId"
                        params={{ deckId: deck.id }}
                        className="text-sm font-medium text-accent-foreground bg-accent px-4 py-2 rounded-full hover:opacity-90"
                      >
                        Учить →
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`Удалить колоду «${deck.name}»?`)) deleteDeck(deck.id);
                        }}
                        className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        aria-label="Удалить колоду"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-center text-sm text-muted-foreground">
        Для спокойных занятий ·{" "}
        <span className="font-display italic">продолжайте в своём ритме</span>.
      </footer>
    </div>
  );
}
