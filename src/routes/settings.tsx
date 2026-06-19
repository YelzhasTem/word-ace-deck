import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowLeft, Settings } from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Memora" },
      { name: "description", content: "Manage learning modes and app preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const t = useT();

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> {t("settings.back")}
        </Link>

        <h1 className="font-display text-4xl font-semibold tracking-tight mb-2">{t("settings.title")}</h1>
        <p className="text-muted-foreground mb-10">{t("settings.desc")}</p>

        <section className="rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-xl flex items-center gap-2">
            <Settings className="h-5 w-5 text-accent" /> App settings
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Deck-specific study settings are managed from each deck page.
          </p>
        </section>
      </main>
    </div>
  );
}
