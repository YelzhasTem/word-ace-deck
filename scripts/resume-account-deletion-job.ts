import { z } from "zod";
import { executeAccountDeletion } from "../src/lib/account-deletion.server.ts";

const JobIdSchema = z.string().uuid();
const jobIdFlag = process.argv.indexOf("--job-id");
const jobId = JobIdSchema.safeParse(jobIdFlag >= 0 ? process.argv[jobIdFlag + 1] : undefined);

if (!jobId.success) {
  process.stderr.write("Usage: npm run account-deletion:resume -- --job-id <uuid>\n");
  process.exitCode = 2;
} else {
  try {
    const result = await executeAccountDeletion(jobId.data);
    process.stdout.write(`Account deletion status: ${result.status}\n`);
  } catch {
    process.stderr.write("Account deletion resume did not complete. Review the safe job status.\n");
    process.exitCode = 1;
  }
}
