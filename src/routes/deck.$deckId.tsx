import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDeck } from "@/lib/decks";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Trash2, Play, RotateCcw, Sparkles, Loader2 } from "lucide-react";
import { generateStudyText } from "@/lib/ai.functions";

export const Route = createFileRoute("/deck/$deckId")({
  component: DeckPage,
});

function renderMarkdown(text: string) {
  // very small markdown: **bold** and line breaks
  const parts: Array<string | { bold: string }> = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ bold: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <strong key={i} className="font-semibold text-foreground bg-accent/15 px-1 rounded">
        {p.bold}
      </strong>
    ),
  );
}

function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function DeckPage() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const { deck, addCard, deleteCard, resetProgress } = useDeck(deckId);
  const [term, setTerm] = useState("");
  const [def, setDef] = useState("");

  if (!deck) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Колода не найдена</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">На главную</Link>
        </main>
      </div>
    );
  }

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!term.trim() || !def.trim()) return;
    addCard(deck.id, term.trim(), def.trim());
    setTerm("");
    setDef("");
  };

  const total = deck.cards.length;
  const known = deck.cards.filter((c) => c.known).length;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" /> Все колоды
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-5xl font-semibold tracking-tight">{deck.name}</h1>
            {deck.description && (
              <p className="mt-3 text-muted-foreground max-w-xl">{deck.description}</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              {total} {plural(total, ["карточка", "карточки", "карточек"])} ·{" "}
              {known} {plural(known, ["выучена", "выучено", "выучено"])}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => resetProgress(deck.id)}
              disabled={!deck.cards.length}
            >
              <RotateCcw className="h-4 w-4" /> Сбросить
            </Button>
            <Button
              className="rounded-full"
              onClick={() => navigate({ to: "/study/$deckId", params: { deckId: deck.id } })}
              disabled={!deck.cards.length}
            >
              <Play className="h-4 w-4" /> Учить
            </Button>
          </div>
        </div>

        {/* Add card */}
        <form
          onSubmit={handleAdd}
          className="rounded-3xl border border-border bg-card p-6 mb-10"
        >
          <h2 className="font-display text-xl mb-4">Добавить карточку</h2>
          <div className="grid md:grid-cols-[1fr_1.4fr_auto] gap-3">
            <Input
              placeholder="Английское слово"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Input
              placeholder="Перевод или определение"
              value={def}
              onChange={(e) => setDef(e.target.value)}
            />
            <Button type="submit" className="rounded-full">
              <Plus className="h-4 w-4" /> Добавить
            </Button>
          </div>
        </form>

        {/* Cards list */}
        <div className="space-y-3">
          {deck.cards.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
              Добавьте первую карточку выше, чтобы начать учить.
            </div>
          ) : (
            deck.cards.map((card) => (
              <div
                key={card.id}
                className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg font-semibold truncate">{card.term}</p>
                  <p className="text-sm text-muted-foreground truncate">{card.definition}</p>
                </div>
                {card.known && (
                  <span className="text-xs px-2 py-1 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)] font-medium">
                    Выучено
                  </span>
                )}
                <button
                  onClick={() => deleteCard(deck.id, card.id)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label="Удалить карточку"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
