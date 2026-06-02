import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDeck, type Card } from "@/lib/decks";
import { generateClozeSentence } from "@/lib/ai.functions";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, isCloseMatch, prioritise } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, FileQuestion, Loader2, Check, X, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/blank/$deckId")({
  component: BlankPage,
});

type Mode = "choice" | "bank" | "free";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function maskSentence(sentence: string, term: string) {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i");
  if (re.test(sentence)) return sentence.replace(re, "_____");
  // fallback: just append blank
  return sentence + " (___)";
}

function BlankPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const gen = useServerFn(generateClozeSentence);

  const queue = useMemo<Card[]>(() => (deck ? prioritise(deckId, deck.cards) : []), [deck, deckId]);
  const [mode, setMode] = useState<Mode>("choice");
  const [idx, setIdx] = useState(0);
  const [sentence, setSentence] = useState("");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<null | "ok" | "miss">(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);

  const current = queue[idx];

  const options = useMemo(() => {
    if (!current || !deck) return [];
    const others = deck.cards.filter((c) => c.id !== current.id);
    const distractors = shuffle(others).slice(0, 3).map((c) => c.term);
    while (distractors.length < 3) distractors.push("—");
    return shuffle([current.term, ...distractors]);
  }, [current?.id, deck?.cards.length]);

  const load = async (card: Card) => {
    setLoading(true); setError(""); setSentence(""); setExplanation(""); setPick(null); setInput(""); setVerdict(null);
    try {
      const r = await gen({ data: { term: card.term, definition: card.definition } });
      setSentence(r.sentence);
      setExplanation(r.explanation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить предложение");
    }
    setLoading(false);
  };

  useEffect(() => { if (current) load(current); /* eslint-disable-next-line */ }, [current?.id]);
  useEffect(() => { setIdx(0); setRight(0); setWrong(0); }, [deckId]);

  if (!deck) {
    return (
      <div className="min-h-screen"><SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Колода не найдена</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">На главную</Link>
        </main>
      </div>
    );
  }

  const total = queue.length;
  const finished = !current;

  const [askedAt, setAskedAt] = useState<number>(() => Date.now());
  useEffect(() => { setAskedAt(Date.now()); }, [current?.id, loading]);

  const submit = () => {
    if (!current || verdict) return;
    const answer = mode === "free" ? input : (pick ?? "");
    if (!answer) return;
    const elapsed = Date.now() - askedAt;
    const ok = isCloseMatch(answer, current.term);
    setVerdict(ok ? "ok" : "miss");
    recordAnswer(deck.id, current.id, ok, elapsed);
    if (ok) { setRight((r) => r + 1); recordStreakToday(); } else { setWrong((w) => w + 1); }
  };
  const next = () => setIdx((i) => i + 1);
  const restart = () => { setIdx(0); setRight(0); setWrong(0); };

  return (
    <div className="min-h-screen"><SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium"><FileQuestion className="h-4 w-4" /> Fill-in-the-blank</span>
        </div>

        <div className="flex gap-2 mb-6">
          {([["choice","Варианты"],["bank","Банк слов"],["free","Свободный ввод"]] as [Mode,string][]).map(([m,label]) => (
            <button key={m} onClick={() => setMode(m)} disabled={!!verdict}
              className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${mode===m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        {finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">📝</p>
            <h2 className="font-display text-3xl font-semibold">Раунд завершён</h2>
            <p className="mt-3 text-muted-foreground">Правильно: {right} из {total}</p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full"><Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link></Button>
              <Button className="rounded-full" onClick={restart}><RotateCcw className="h-4 w-4" /> Ещё раз</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex justify-between text-xs text-muted-foreground">
              <span>{idx + 1} / {total}</span>
              <span><span className="text-[color:var(--success)]">✓ {right}</span> · <span className="text-destructive">✗ {wrong}</span></span>
            </div>

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-8 mb-6">
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Готовим предложение…</div>
              ) : error ? (
                <div className="text-destructive text-sm">{error} <button className="underline ml-2" onClick={() => current && load(current)}>повторить</button></div>
              ) : (
                <p className="font-display text-2xl leading-relaxed">{maskSentence(sentence, current!.term)}</p>
              )}
              
            </div>

            {mode === "choice" && (
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                {options.map((opt, i) => {
                  const correct = opt === current!.term;
                  const isPicked = pick === opt;
                  const show = verdict !== null;
                  const cls = !show
                    ? `border-border bg-card hover:border-accent hover:bg-accent/5 ${isPicked ? "border-accent bg-accent/5" : ""}`
                    : correct ? "border-[color:var(--success)] bg-[color:var(--success)]/10"
                    : isPicked ? "border-destructive bg-destructive/10" : "border-border bg-card opacity-60";
                  return (
                    <button key={i} disabled={!!verdict} onClick={() => setPick(opt)}
                      className={`text-left rounded-2xl border-2 px-5 py-4 ${cls}`}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
            {mode === "bank" && (
              <div className="flex flex-wrap gap-2 mb-4">
                {options.map((opt, i) => (
                  <button key={i} disabled={!!verdict} onClick={() => setPick(opt)}
                    className={`px-4 py-2 rounded-full border ${pick===opt ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-accent"}`}>
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {mode === "free" && (
              <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Введите слово…" disabled={!!verdict} className="h-12 rounded-2xl mb-4" />
            )}

            {verdict === "ok" && (
              <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-5 py-4 mb-4 flex items-start gap-3">
                <Check className="h-6 w-6 mt-0.5 shrink-0" />
                <div className="text-sm leading-relaxed">
                  <p className="font-semibold">Верно — {current!.term}</p>
                  <p className="mt-1 opacity-90">{explanation}</p>
                </div>
              </div>
            )}
            {verdict === "miss" && (
              <div className="rounded-2xl bg-destructive/10 text-destructive px-5 py-4 mb-4 flex items-start gap-3">
                <X className="h-6 w-6 mt-0.5 shrink-0" />
                <div className="text-sm leading-relaxed">
                  <p className="font-semibold">Правильный ответ: {current!.term}</p>
                  <p className="mt-1 opacity-90">{explanation}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              {!verdict ? (
                <Button className="rounded-full" onClick={submit} disabled={loading || (mode==="free" ? !input.trim() : !pick)}>Проверить</Button>
              ) : (
                <Button className="rounded-full" onClick={next}>{idx + 1 < total ? "Дальше" : "Завершить"}</Button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
