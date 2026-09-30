import process from "node:process";
import { validateAccountDeletionRuntimeEnv } from "./account-deletion-runtime.ts";

const usage =
  "Usage: node --experimental-strip-types scripts/check-account-deletion-runtime.ts --expected-project-ref <hosted-project-ref>\n";
const limitations =
  "Offline shape-only check: signatures, key/project binding, permissions, and liveness are NOT verified. No network requests or mutations.\n";

try {
  const args = process.argv.slice(2);
  const expectedProjectRef =
    args.length === 2 && args[0] === "--expected-project-ref"
      ? args[1]
      : args.length === 1 && args[0].startsWith("--expected-project-ref=")
        ? args[0].slice("--expected-project-ref=".length)
        : undefined;

  if (!expectedProjectRef) {
    process.stderr.write(usage + limitations);
    process.exitCode = 2;
  } else {
    const result = validateAccountDeletionRuntimeEnv(
      process.env,
      expectedProjectRef,
      Date.now() / 1000,
    );
    if (!result.ok) {
      process.stderr.write(
        `Account deletion runtime preflight failed: ${result.error}\n${limitations}`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Account deletion runtime preflight passed (${result.keyFormat}, shape-only).\n${limitations}`,
      );
    }
  }
} catch {
  // Never serialize thrown errors: parser errors can carry credential-bearing input.
  process.stderr.write(
    `Account deletion runtime preflight could not complete safely.\n${limitations}`,
  );
  process.exitCode = 1;
}
