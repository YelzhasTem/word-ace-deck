import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Flag, Shield } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { getModerationQueue, reviewDeckReport } from "@/lib/community.functions";
import {
  getCollectionModerationQueue,
  getUserModerationQueue,
  reviewCollectionReport,
  reviewUserReport,
} from "@/lib/safety.functions";

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

type CollectionReport = {
  id: string;
  collection_id: string;
  reason: string;
  created_at: string;
};

type UserReport = {
  id: string;
  reported_user_id: string;
  reported_name: string;
  reason: string;
  created_at: string;
};

function CommunityAdminPage() {
  const loadQueue = useServerFn(getModerationQueue);
  const reviewReport = useServerFn(reviewDeckReport);
  const loadCollectionQueue = useServerFn(getCollectionModerationQueue);
  const reviewCollection = useServerFn(reviewCollectionReport);
  const loadUserQueue = useServerFn(getUserModerationQueue);
  const reviewUser = useServerFn(reviewUserReport);
  const [reports, setReports] = useState<Report[]>([]);
  const [collectionReports, setCollectionReports] = useState<CollectionReport[]>([]);
  const [userReports, setUserReports] = useState<UserReport[]>([]);

  const refresh = () => {
    void loadQueue().then((res) => setReports(res.reports as Report[]));
    void loadCollectionQueue()
      .then((res) => setCollectionReports(res.reports as CollectionReport[]))
      .catch(() => undefined);
    void loadUserQueue()
      .then((res) => setUserReports(res.reports as UserReport[]))
      .catch(() => undefined);
  };

  useEffect(() => {
    refresh();
  }, []);

  const review = async (report: Report, action: "hide" | "dismiss") => {
    await reviewReport({ data: { reportId: report.id, deckId: report.deck_id, action } });
    setReports((prev) => prev.filter((item) => item.id !== report.id));
  };

  const reviewCollectionItem = async (report: CollectionReport, action: "hide" | "dismiss") => {
    await reviewCollection({ data: { reportId: report.id, action } });
    setCollectionReports((prev) => prev.filter((item) => item.id !== report.id));
  };

  const reviewUserItem = async (report: UserReport, action: "reviewed" | "dismissed") => {
    await reviewUser({ data: { reportId: report.id, action } });
    setUserReports((prev) => prev.filter((item) => item.id !== report.id));
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
            <p className="text-sm text-muted-foreground">
              Review reported decks, collections and users. Act on reports within 24 hours.
            </p>
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
                      <Link
                        to="/community/$deckId"
                        params={{ deckId: report.deck_id }}
                        className="text-primary hover:underline"
                      >
                        Open deck
                      </Link>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => review(report, "dismiss")}>
                      Dismiss
                    </Button>
                    <Button variant="destructive" onClick={() => review(report, "hide")}>
                      Hide deck
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <h2 className="mt-10 font-display text-xl font-bold">Reported collections</h2>
        <div className="mt-4 space-y-3">
          {collectionReports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No pending collection reports.
            </div>
          ) : (
            collectionReports.map((report) => (
              <div key={report.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
                      <Flag className="h-4 w-4" /> Reported collection
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{report.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{new Date(report.created_at).toLocaleString()}</span>
                      <Link
                        to="/collections/$collectionId"
                        params={{ collectionId: report.collection_id }}
                        className="text-primary hover:underline"
                      >
                        Open collection
                      </Link>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => reviewCollectionItem(report, "dismiss")}
                    >
                      Dismiss
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => reviewCollectionItem(report, "hide")}
                    >
                      Hide collection
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <h2 className="mt-10 font-display text-xl font-bold">Reported users</h2>
        <div className="mt-4 space-y-3">
          {userReports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No pending user reports.
            </div>
          ) : (
            userReports.map((report) => (
              <div key={report.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-destructive">
                      <Flag className="h-4 w-4" /> Reported user: {report.reported_name}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{report.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{new Date(report.created_at).toLocaleString()}</span>
                      <Link
                        to="/creator/$userId"
                        params={{ userId: report.reported_user_id }}
                        className="text-primary hover:underline"
                      >
                        Open profile
                      </Link>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      To remove the account, delete the user in Supabase Dashboard → Authentication.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => reviewUserItem(report, "dismissed")}>
                      Dismiss
                    </Button>
                    <Button onClick={() => reviewUserItem(report, "reviewed")}>Mark handled</Button>
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
