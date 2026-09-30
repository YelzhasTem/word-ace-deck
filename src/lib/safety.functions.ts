import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reportDatabaseErrorMessage, reportReasonSchema } from "@/lib/report-validation";

// Blocking, user reports and the extra moderation queues required for
// user-generated content (App Store Guideline 1.2).

const userIdInput = (input: unknown) => z.object({ userId: z.string().uuid() }).parse(input);

export const getBlockStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(userIdInput)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", context.userId)
      .eq("blocked_id", data.userId)
      .maybeSingle();
    if (error) throw new Error("Could not load block status.");
    return { blocked: Boolean(row) };
  });

export const blockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(userIdInput)
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) throw new Error("You cannot block yourself.");
    const { error } = await context.supabase
      .from("user_blocks")
      .upsert(
        { blocker_id: context.userId, blocked_id: data.userId },
        { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
      );
    if (error) throw new Error("Could not block this user. Please try again.");
    // Stop following them too; their decks are hidden from now on anyway.
    await context.supabase
      .from("creator_follows")
      .delete()
      .eq("follower_id", context.userId)
      .eq("creator_id", data.userId);
    await context.supabase
      .from("friendships")
      .delete()
      .or(
        `and(requester_id.eq.${context.userId},addressee_id.eq.${data.userId}),and(requester_id.eq.${data.userId},addressee_id.eq.${context.userId})`,
      );
    return { blocked: true };
  });

export const unblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(userIdInput)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", context.userId)
      .eq("blocked_id", data.userId);
    if (error) throw new Error("Could not unblock this user. Please try again.");
    return { blocked: false };
  });

export const getBlockedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("user_blocks")
      .select("blocked_id, created_at")
      .eq("blocker_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load blocked users.");
    const ids = (rows ?? []).map((row) => row.blocked_id);
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("user_id, username, display_name")
        .in("user_id", ids);
      for (const profile of profiles ?? []) {
        names.set(profile.user_id, profile.display_name || profile.username || "User");
      }
    }
    return {
      users: ids.map((id) => ({ userId: id, name: names.get(id) ?? "User" })),
    };
  });

export const reportUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), reason: reportReasonSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.userId === context.userId) throw new Error("You cannot report yourself.");
    const { error } = await context.supabase.from("user_reports").insert({
      reported_user_id: data.userId,
      reporter_id: context.userId,
      reason: data.reason,
    });
    if (error) throw new Error(reportDatabaseErrorMessage(error));
    return { ok: true };
  });

export const getCollectionModerationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("collection_reports")
      .select("id, collection_id, reporter_id, reason, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { reports: data ?? [] };
  });

export const reviewCollectionReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ reportId: z.string().uuid(), action: z.enum(["hide", "dismiss"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("moderate_marketplace_report", {
      p_resource_type: "collection",
      p_report_id: data.reportId,
      p_action: data.action,
    });
    if (error) throw new Error("Could not update the report.");
    return { ok: true };
  });

export const getUserModerationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_reports")
      .select("id, reported_user_id, reporter_id, reason, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((row) => row.reported_user_id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("user_id, username, display_name")
        .in("user_id", ids);
      for (const profile of profiles ?? []) {
        names.set(profile.user_id, profile.display_name || profile.username || "User");
      }
    }
    return {
      reports: (data ?? []).map((row) => ({
        ...row,
        reported_name: names.get(row.reported_user_id) ?? "User",
      })),
    };
  });

export const reviewUserReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ reportId: z.string().uuid(), action: z.enum(["reviewed", "dismissed"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("user_reports")
      .update({ status: data.action, reviewed_at: new Date().toISOString() })
      .eq("id", data.reportId)
      .select("id");
    if (error || !rows?.length) throw new Error("Could not update the report.");
    return { ok: true };
  });
