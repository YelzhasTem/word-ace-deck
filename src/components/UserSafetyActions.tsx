import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getReportReasonValidationMessage } from "@/lib/report-validation";
import { blockUser, getBlockStatus, reportUser, unblockUser } from "@/lib/safety.functions";

type Props = {
  userId: string;
  name: string;
  className?: string;
};

// Report and Block controls for another user's public content (App Store Guideline 1.2).
export function UserSafetyActions({ userId, name, className }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadStatus = useServerFn(getBlockStatus);
  const block = useServerFn(blockUser);
  const unblock = useServerFn(unblockUser);
  const report = useServerFn(reportUser);
  const [blocked, setBlocked] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"block" | "report" | null>(null);
  const [isSelf, setIsSelf] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setIsSelf(data.session?.user.id === userId);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;
    loadStatus({ data: { userId } })
      .then((res) => {
        if (active) setBlocked(res.blocked);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadStatus, userId]);

  const onBlock = async () => {
    setBusy("block");
    try {
      await block({ data: { userId } });
      setBlocked(true);
      setConfirmBlock(false);
      await queryClient.invalidateQueries();
      toast.success(`${name} is blocked. You will no longer see their content.`);
      await navigate({ to: "/community" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not block this user.");
    } finally {
      setBusy(null);
    }
  };

  const onUnblock = async () => {
    setBusy("block");
    try {
      await unblock({ data: { userId } });
      setBlocked(false);
      await queryClient.invalidateQueries();
      toast.success(`${name} is unblocked.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unblock this user.");
    } finally {
      setBusy(null);
    }
  };

  const reasonError = getReportReasonValidationMessage(reason);

  if (isSelf) return null;

  const onReport = async () => {
    if (reasonError) {
      toast.error(reasonError);
      return;
    }
    setBusy("report");
    try {
      await report({ data: { userId, reason } });
      setReportOpen(false);
      setReason("");
      toast.success("Report sent. We review reports within 24 hours.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the report.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setReportOpen(true)}
        >
          <Flag className="h-4 w-4" /> Report user
        </Button>
        {blocked ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={onUnblock}
            disabled={busy === "block"}
          >
            {busy === "block" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            Unblock
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full text-destructive hover:text-destructive"
            onClick={() => setConfirmBlock(true)}
          >
            <Ban className="h-4 w-4" /> Block
          </Button>
        )}
      </div>

      <AlertDialog open={confirmBlock} onOpenChange={setConfirmBlock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their decks and collections will be hidden from you, you will stop following them, and
              neither of you can send the other a friend request. You can unblock them later in
              Profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "block"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onBlock();
              }}
              disabled={busy === "block"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy === "block" && <Loader2 className="h-4 w-4 animate-spin" />}
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report {name}</DialogTitle>
            <DialogDescription>
              Tell us what is wrong, for example offensive username, abusive content, or spam. We
              review reports within 24 hours.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason"
            maxLength={400}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReportOpen(false)}
              disabled={busy === "report"}
            >
              Cancel
            </Button>
            <Button onClick={onReport} disabled={busy === "report" || Boolean(reasonError)}>
              {busy === "report" && <Loader2 className="h-4 w-4 animate-spin" />}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
