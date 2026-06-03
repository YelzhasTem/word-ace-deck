import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Clock,
  Sparkles,
  BookOpen,
  Repeat,
  TrendingUp,
  ArrowRight,
  Check,
  Moon,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Memora — учим английские слова и запоминаем надолго" },
      {
        name: "description",
        content:
          "Memora — приложение для изучения английской лексики с интервальными повторениями. Откладывайте слова в долгосрочную память и больше их не забывайте.",
      },
      { property: "og:title", content: "Memora — учим английские слова надолго" },
      {
        property: "og:description",
        content:
          "Учите vocabulary по карточкам с интервальными повторениями — слова закрепляются в долгосрочной памяти.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
      } else {
        setChecking(false);
      }
    });
  }, [navigate]);

  if (checking) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-accent grid place-items-center text-primary-foreground font-display font-bold">
              M
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Memora</span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Возможности</a>
            <a href="#how" className="hover:text-foreground transition-colors">Как это работает</a>
            <a href="#why" className="hover:text-foreground transition-colors">Почему Memora</a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleDark}
              aria-label="Переключить тему"
              className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
            >
              <Moon className="h-4 w-4" />
            </button>
            <Button asChild className="rounded-full">
              <Link to="/auth">Начать</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_18%,transparent),transparent_60%)]" />
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28 text-center">
          <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-accent mb-6">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            Vocabulary, который остаётся с вами
          </p>
          <h1 className="font-display text-5xl md:text-7xl font-extrabold leading-[1.02] tracking-tight max-w-4xl mx-auto">
            Учите английские слова{" "}
            <span className="text-primary">и запоминайте их навсегда</span>
          </h1>
          <p className="mt-7 max-w-2xl mx-auto text-lg md:text-xl leading-relaxed text-muted-foreground">
            Memora использует систему интервальных повторений, которая откладывает каждое слово в
            долгосрочную память. Никакой зубрёжки — только короткие повторы в нужный момент.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-full px-7 h-13 text-base">
              <Link to="/auth">
                Начать учить <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-7 h-13 text-base bg-card">
              <a href="#how">Как это работает</a>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Без рекламы</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> AI-генерация колод</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> Прогресс синхронизируется</span>
          </div>
        </div>
      </section>

      {/* Key feature: long-term memory */}
      <section id="why" className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl border border-border bg-card p-8 md:p-14 grid md:grid-cols-[1.1fr_1fr] gap-10 items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-primary mb-4">
              <Brain className="h-3.5 w-3.5" /> Главная фишка
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-bold leading-tight tracking-tight">
              Слова уходят в долгосрочную память — а не вылетают через день
            </h2>
            <p className="mt-5 text-muted-foreground leading-relaxed">
              Memora отслеживает, насколько уверенно вы знаете каждое слово, и сам решает, когда показать
              его снова: через 10 минут, через день, через неделю, через месяц. Это называется
              <span className="text-foreground font-medium"> интервальные повторения</span> — научно
              доказанный метод, на котором построены лучшие приложения для запоминания.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Каждое слово получает свой персональный график повторений",
                "Сложные слова показываются чаще, лёгкие — реже",
                "Уведомления подсказывают, когда пора повторить",
                "Видите свой прогресс: «учится», «запомнено», «освоено»",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "10 мин", sub: "Новое" },
              { label: "1 день", sub: "Учится" },
              { label: "3 дня", sub: "Запомнено" },
              { label: "1 неделя", sub: "Уверенно" },
              { label: "2 недели", sub: "Освоено" },
              { label: "1 месяц", sub: "В памяти" },
            ].map((s, i) => (
              <div
                key={s.label}
                className="rounded-2xl border border-border bg-background p-5"
                style={{ opacity: 0.55 + i * 0.075 }}
              >
                <div className="text-2xl font-display font-bold text-primary">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            Всё, что нужно для словарного запаса
          </h2>
          <p className="mt-4 text-muted-foreground">
            Карточки, режимы тренировок, AI-генерация и аналитика прогресса — в одном месте.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: Clock,
              title: "Интервальные повторения",
              desc: "Сердце Memora — алгоритм, который сам распределяет повторы во времени, чтобы слова оседали в долгосрочной памяти.",
            },
            {
              icon: Sparkles,
              title: "AI-генерация колод",
              desc: "Введите тему, уровень или ссылку на статью — ИИ соберёт готовую колоду с переводами за секунды.",
            },
            {
              icon: Repeat,
              title: "7 режимов тренировок",
              desc: "Карточки, ввод с клавиатуры, обратный перевод, ассоциации, скоростной режим и глубокая проработка.",
            },
            {
              icon: BookOpen,
              title: "Свои колоды",
              desc: "Создавайте колоды под себя: путешествия, IELTS, работа, любимый сериал. Без ограничений.",
            },
            {
              icon: TrendingUp,
              title: "Прогресс и стрики",
              desc: "Видите retention, количество освоенных слов и поддерживаете стрик ежедневных занятий.",
            },
            {
              icon: Brain,
              title: "Умные напоминания",
              desc: "Memora подскажет, когда колода «созрела» для повтора — не раньше и не позже.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-6 hover:border-primary/40 transition-colors"
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            Как это работает
          </h2>
          <p className="mt-4 text-muted-foreground">Четыре шага — от первого слова до уверенного владения.</p>
        </div>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { n: "01", t: "Создайте колоду", d: "Вручную, через AI или из ссылки на статью." },
            { n: "02", t: "Учите карточки", d: "Выберите удобный режим — от простых карточек до ввода." },
            { n: "03", t: "Повторяйте по графику", d: "Memora напомнит, когда вернуться к словам." },
            { n: "04", t: "Запоминайте надолго", d: "Слова переходят в долгосрочную память." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-6">
              <div className="text-xs font-mono text-primary mb-3">{s.n}</div>
              <h3 className="font-display text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-accent p-10 md:p-16 text-center text-primary-foreground">
          <h2 className="font-display text-3xl md:text-5xl font-bold tracking-tight">
            Начните учить слова, которые останутся с вами
          </h2>
          <p className="mt-5 max-w-xl mx-auto opacity-90 text-lg">
            Бесплатно. Без рекламы. Регистрация занимает 20 секунд.
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="rounded-full px-8 h-13 text-base"
            >
              <Link to="/auth">
                Создать аккаунт <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center text-primary-foreground font-display font-bold text-xs">
              M
            </div>
            <span>© {new Date().getFullYear()} Memora. Учите слова — навсегда.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/auth" className="hover:text-foreground transition-colors">Войти</Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">Регистрация</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
