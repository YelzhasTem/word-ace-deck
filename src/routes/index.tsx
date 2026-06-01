import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDecks } from "@/lib/decks";
import { SiteHeader } from "@/components/SiteHeader";
import { StreakCard } from "@/components/StreakCard";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { generateDeckWithAI } from "@/lib/ai.functions";
import { Plus, Trash2, BookOpen, Sparkles, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Лингвокарточки — учим английские слова" },
      { name: "description", content: "Создавайте свои колоды и учите английские слова по карточкам." },
    ],
  }),
  component: Home,
});

function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function Home() {
  const { decks, createDeck, createDeckWithCards, deleteDeck } = useDecks();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  // AI generation state
  const [aiTopic, setAiTopic] = useState("");
  const [aiLevel, setAiLevel] = useState("B1");
  const [aiCount, setAiCount] = useState(10);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const genDeck = useServerFn(generateDeckWithAI);

  const handleCreate = () => {
    if (!name.trim()) return;
    createDeck(name.trim(), desc.trim());
    setName("");
    setDesc("");
    setOpen(false);
  };

  const handleAIGenerate = async () => {
    if (!aiTopic.trim()) return;
    setAiLoading(true);
    setAiError("");
    try {
      const result = await genDeck({
        data: { topic: aiTopic.trim(), level: aiLevel as "A1" | "A2" | "B1" | "B2" | "C1" | "C2", count: aiCount },
      });
      createDeckWithCards(result.name, result.description, result.cards);
      setAiTopic("");
      setOpen(false);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Не удалось создать колоду");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        {/* Hero */}
        <section className="grid md:grid-cols-[1.4fr_1fr] gap-10 items-center mb-14">
          <div className="animate-float-in">
            <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent mb-5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              Спокойное обучение
            </p>
            <h1 className="font-display text-4xl md:text-6xl font-extrabold leading-[1.05] tracking-tight text-foreground">
              Учите английский <br />
              <span className="text-primary">фокусированно</span> и без шума.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Создавайте колоды, отслеживайте прогресс и тренируйте память —
              интерфейс продуман для долгих, комфортных сессий.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="lg" className="rounded-full px-6 h-12 text-[15px] shadow-sm">
                    <Plus className="h-4 w-4" /> Новая колода
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="font-display text-2xl">Создать колоду</DialogTitle>
                    <DialogDescription>
                      Выберите способ создания: вручную или с помощью ИИ.
                    </DialogDescription>
                  </DialogHeader>
                  <Tabs defaultValue="manual" className="mt-2">
                    <TabsList className="w-full grid grid-cols-2">
                      <TabsTrigger value="manual">Вручную</TabsTrigger>
                      <TabsTrigger value="ai" className="gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" /> С помощью ИИ
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="manual" className="mt-4 space-y-4">
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
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
                        <Button onClick={handleCreate}>Создать</Button>
                      </DialogFooter>
                    </TabsContent>

                    <TabsContent value="ai" className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Тема колоды</label>
                        <Input
                          autoFocus
                          placeholder="Например: путешествия, кулинария, IT"
                          value={aiTopic}
                          onChange={(e) => setAiTopic(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !aiLoading && handleAIGenerate()}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Уровень</label>
                          <select
                            value={aiLevel}
                            onChange={(e) => setAiLevel(e.target.value)}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Карточек</label>
                          <Input
                            type="number"
                            min={3}
                            max={30}
                            value={aiCount}
                            onChange={(e) => setAiCount(Math.min(30, Math.max(3, Number(e.target.value) || 0)))}
                          />
                        </div>
                      </div>
                      {aiError && (
                        <p className="text-sm text-destructive">{aiError}</p>
                      )}
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
                        <Button onClick={handleAIGenerate} disabled={aiLoading || !aiTopic.trim()}>
                          {aiLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" /> Генерация…
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" /> Сгенерировать
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
              {decks[0] && (
                <Button asChild size="lg" variant="outline" className="rounded-full px-6 h-12 text-[15px] bg-card">
                  <Link to="/study/$deckId" params={{ deckId: decks[0].id }}>
                    <BookOpen className="h-4 w-4" /> Продолжить
                  </Link>
                </Button>
              )}
            </div>

            <div className="mt-10 grid grid-cols-3 gap-3 max-w-md">
              {[
                { label: "Колод", value: decks.length },
                { label: "Карточек", value: decks.reduce((s, d) => s + d.cards.length, 0) },
                { label: "Выучено", value: decks.reduce((s, d) => s + d.cards.filter(c => c.known).length, 0) },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl bg-card border border-border/70 px-4 py-3 shadow-[var(--shadow-soft)]">
                  <p className="text-2xl font-display font-bold text-primary tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative hidden md:block">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-accent/20 via-transparent to-primary/10 blur-2xl" />
            <div className="relative rounded-3xl bg-card border border-border/70 p-8 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">noun · C1</span>
                <span className="inline-flex h-2 w-2 rounded-full bg-success" />
              </div>
              <p className="font-display text-4xl font-bold text-foreground">serendipity</p>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Счастливая случайность; способность находить хорошее без поиска.
              </p>
              <div className="mt-6 flex gap-2 flex-wrap">
                <span className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground font-medium">/ˌserənˈdɪpɪti/</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-primary font-medium">любимое</span>
              </div>
              <div className="mt-8 pt-6 border-t border-border/70 flex items-center justify-between text-xs text-muted-foreground">
                <span>Карточка 7 из 24</span>
                <span className="font-medium text-success">+3 за сегодня</span>
              </div>
            </div>
          </div>
        </section>

        {/* Decks */}
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Ваши колоды</h2>
            <span className="text-sm text-muted-foreground">
              {decks.length} {plural(decks.length, ["колода", "колоды", "колод"])}
            </span>
          </div>

          {decks.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-border bg-card/50 p-16 text-center">
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
                    className="group relative rounded-3xl bg-card border border-border/70 p-6 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:border-accent/40 transition-all duration-300"
                  >
                    <Link
                      to="/deck/$deckId"
                      params={{ deckId: deck.id }}
                      className="block"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="h-10 w-10 rounded-xl bg-accent/15 text-primary inline-flex items-center justify-center">
                          <BookOpen className="h-5 w-5" />
                        </div>
                        {pct === 100 && total > 0 && (
                          <span className="text-[10px] uppercase tracking-wider font-bold text-success">готово</span>
                        )}
                      </div>
                      <h3 className="font-display text-xl font-bold leading-tight tracking-tight">{deck.name}</h3>
                      {deck.description && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">{deck.description}</p>
                      )}

                      <div className="mt-6">
                        <div className="flex justify-between text-xs font-medium text-muted-foreground mb-1.5">
                          <span>
                            {total} {plural(total, ["карточка", "карточки", "карточек"])}
                          </span>
                          <span className="text-primary tabular-nums">{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-accent to-primary transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </Link>

                    <div className="mt-5 flex items-center justify-between">
                      <Link
                        to="/study/$deckId"
                        params={{ deckId: deck.id }}
                        className="text-sm font-semibold text-primary-foreground bg-primary px-4 py-2 rounded-full hover:bg-primary/90 transition-colors"
                      >
                        Учить →
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`Удалить колоду «${deck.name}»?`)) deleteDeck(deck.id);
                        }}
                        className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
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
        Спокойно. Сосредоточенно. В своём ритме.
      </footer>
    </div>
  );
}
