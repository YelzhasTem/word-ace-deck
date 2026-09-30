import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Database } from "../src/integrations/supabase/types.ts";
import {
  validateAccountDeletionRuntimeEnv,
  type AccountDeletionRuntimeEnv,
} from "./account-deletion-runtime.ts";

const AttentionRowSchema = z
  .object({
    job_id: z.string().uuid(),
    job_status: z.enum([
      "requested",
      "storage_cleanup_pending",
      "auth_deletion_pending",
      "capability_drain_pending",
      "database_verification_pending",
      "completed",
      "failed_retryable",
      "failed_terminal",
    ]),
    resume_step: z.enum([
      "storage_cleanup",
      "auth_deletion",
      "capability_drain",
      "database_verification",
      "done",
    ]),
    attempt_count: z.number().int().nonnegative().safe(),
    next_retry_at: z
      .string()
      .max(40)
      .datetime({ offset: true })
      .refine((value) => Number.isFinite(Date.parse(value)))
      .nullable(),
    age_seconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    last_error_code: z
      .enum([
        "STORAGE_TEMPORARY",
        "AUTH_TEMPORARY",
        "DATABASE_TEMPORARY",
        "PROVIDER_RESIDUAL",
        "WORKFLOW_TIMEOUT",
        "ATTEMPT_LIMIT_REACHED",
      ])
      .nullable(),
  })
  .strip();

const AttentionPageSchema = z.array(AttentionRowSchema).max(100);

export function renderAccountDeletionAttention(value: unknown): string {
  const result = AttentionPageSchema.safeParse(value);
  // Never surface Zod issues: rejected field values may contain private data.
  if (!result.success) throw new Error("Invalid account deletion attention response.");
  return `${JSON.stringify(result.data)}\n`;
}

const ArgumentsSchema = z.object({
  expectedProjectRef: z.string().min(1),
  afterJobId: z.string().uuid().optional(),
});

function parseArguments(args: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const name =
      flag === "--expected-project-ref"
        ? "expectedProjectRef"
        : flag === "--after-job-id"
          ? "afterJobId"
          : undefined;
    const value = args[index + 1];
    if (!name || values[name] !== undefined || !value || value.startsWith("--")) {
      return null;
    }
    values[name] = value;
  }
  const parsed = ArgumentsSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}

async function listAttentionPage(
  supabaseUrl: string,
  serviceRoleKey: string,
  afterJobId: string | undefined,
  fetcher: typeof globalThis.fetch,
) {
  const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
    db: { schema: "public" },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetcher(input, { ...init, redirect: "error" }),
    },
  });
  const { data, error } = await client
    .rpc(
      "list_account_deletion_attention",
      {
        p_limit: 100,
        ...(afterJobId ? { p_after_job_id: afterJobId } : {}),
      },
      { get: true },
    )
    .retry(false)
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error("Account deletion attention query failed.");
  return renderAccountDeletionAttention(data);
}

type ListJobsOptions = {
  env?: AccountDeletionRuntimeEnv;
  fetch?: typeof globalThis.fetch;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
};

export async function runListAccountDeletionJobs(
  args: string[] = process.argv.slice(2),
  options: ListJobsOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value: string) => process.stderr.write(value));
  const parsed = parseArguments(args);
  if (!parsed) {
    stderr("Usage: --expected-project-ref <ref> [--after-job-id <uuid>]\n");
    return 2;
  }

  try {
    const source = options.env ?? process.env;
    const env = {
      SUPABASE_URL: source.SUPABASE_URL,
      VITE_SUPABASE_URL: source.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    };
    const validation = validateAccountDeletionRuntimeEnv(
      env,
      parsed.expectedProjectRef,
      Math.floor(Date.now() / 1000),
    );
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!validation.ok || !url || !key) {
      stderr("Account deletion runtime validation failed. No request was sent.\n");
      return 2;
    }

    const output = await listAttentionPage(url, key, parsed.afterJobId, options.fetch ?? fetch);
    stdout(output);
    return 0;
  } catch {
    stderr("Could not list account deletion attention jobs. No job changes were requested.\n");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runListAccountDeletionJobs();
}
