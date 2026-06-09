import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Flag, Shield } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { getModerationQueue, reviewDeckReport } from "@/lib/community.functions";

export const Route = createFileRoute("/community-admin")({
  component: CommunityAdminPage,
});

type Report = {
  id: string;
  deck_id: string;
  reporter_id: string;
  reason: string;
  status: string;
  created_at: string;
};

function CommunityAdminPage() {
  const loadQueue = useServerFn(getModerationQueue);
  const reviewReport = useServerFn(reviewDeckReport);
  const [reports, setReports] = useState<Report[]>([]);

  const refresh = () => loadQueue().then((res) => setReports(res.reports as Report[]));

  useEffect(() => {
    refresh();
  }, []);

  const review = async (report: Report, action: "hide" | "dismiss") => {
    await reviewReport({ data: { reportId: report.id, deckId: report.deck_id, action } });
    setReports((prev) => prev.filter((item) => item.id !== report.id));
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Admin review queue</h1>
            <p className="text-sm text-muted-foreground">Review reported marketplace decks and hide inappropriate content.</p>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          {reports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              No pending reports.
            </div>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
                      <Flag className="h-4 w-4" /> Reported deck
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{report.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{new Date(report.created_at).toLocaleString()}</span>
                      <Link to="/community/$deckId" params={{ deckId: report.deck_id }} className="text-primary hover:underline">
                        Open deck
                      </Link>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => review(report, "dismiss")}>Dismiss</Button>
                    <Button variant="destructive" onClick={() => review(report, "hide")}>Hide deck</Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
