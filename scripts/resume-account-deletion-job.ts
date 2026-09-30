import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Database } from "../src/integrations/supabase/types.ts";
import { createAccountDeletionBackend } from "../src/lib/account-deletion.server.ts";
import { runAccountDeletionWorkflow } from "../src/lib/account-deletion-workflow.ts";
import {
  validateAccountDeletionRuntimeEnv,
  type AccountDeletionRuntimeEnv,
} from "./account-deletion-runtime.ts";

const ArgumentsSchema = z.object({
  expectedProjectRef: z.string().regex(/^[a-z0-9]{20}$/),
  jobId: z.string().uuid(),
});

function parseArguments(args: string[]) {
  if (args.length !== 4) return null;
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name =
      args[index] === "--expected-project-ref"
        ? "expectedProjectRef"
        : args[index] === "--job-id"
          ? "jobId"
          : undefined;
    if (!name || values[name] !== undefined) return null;
    values[name] = args[index + 1];
  }
  const parsed = ArgumentsSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}

type ResumeOptions = {
  env?: AccountDeletionRuntimeEnv;
  fetch?: typeof globalThis.fetch;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
};

export async function runResumeAccountDeletionJob(
  args: string[] = process.argv.slice(2),
  options: ResumeOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value: string) => process.stderr.write(value));
  const parsed = parseArguments(args);
  if (!parsed) {
    stderr(
      "Usage: npm run account-deletion:resume -- --expected-project-ref <ref> --job-id <uuid>\n",
    );
    return 2;
  }

  try {
    const source = options.env ?? process.env;
    const env = Object.freeze({
      SUPABASE_URL: source.SUPABASE_URL,
      VITE_SUPABASE_URL: source.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    });
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

    // Bind the backend to this validated snapshot, not the default ambient-env client.
    const fetcher = options.fetch ?? globalThis.fetch;
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) =>
          fetcher(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(15_000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    });
    const result = await runAccountDeletionWorkflow(
      createAccountDeletionBackend(client),
      parsed.jobId,
    );
    stdout(`Account deletion status: ${result.status}\n`);
    return 0;
  } catch {
    stderr("Account deletion resume did not complete. Review the safe job status.\n");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runResumeAccountDeletionJob();
}
