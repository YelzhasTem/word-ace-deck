# Account deletion security

## Transaction boundary

Memora does not describe account deletion as one distributed transaction. PostgreSQL can
atomically update database rows, but Supabase Storage and Supabase Auth are separate services.
The deletion workflow therefore uses durable state, idempotent steps, a lease, and final
verification. A failure is either resumable or recorded as a terminal operational failure; it
must never be reported as success while user data remains.

The coordinator runs only on the server. `SUPABASE_SERVICE_ROLE_KEY` must never be imported by
browser code, exposed through a `VITE_*` variable, logged, or returned to the client.

## State machine

The durable record is `private.account_deletion_jobs`. It deliberately has no foreign key to
`auth.users`, so it survives Auth deletion and can record the final result. It stores no email,
username, token, avatar URL, card content, or full Storage path.

The normal transitions are:

1. `requested` / `storage_cleanup`
2. `storage_cleanup_pending` / `storage_cleanup`
3. `auth_deletion_pending` / `auth_deletion`
4. `database_verification_pending` / `database_verification`
5. `completed` / `done`

Failures become `failed_retryable` or `failed_terminal`. A retryable job retains its exact
`resume_step`. One active job exists per user hash. A ten-minute lease prevents two workers from
performing the same step concurrently, and an expired lease can be reclaimed after a serverless
interruption. Retry backoff and an eight-attempt ceiling prevent an unbounded loop.

The retained hash also acts as a deletion tombstone. A previously issued access JWT can remain
cryptographically valid for part of its original lifetime even after the Auth row and sessions are
deleted. Middleware, database triggers, and avatar policies continue to block that user reference
after `completed`; clearing `user_id` does not remove this protection. A retry with that token
returns the same completed job so the client can safely clear its remaining local state.

## Deletion order

1. The authenticated user types `DELETE`; the server derives the user ID from the verified JWT.
2. `request_account_deletion()` creates or returns the existing job.
3. New authenticated mutations are blocked by the shared server middleware and database
   triggers. Avatar Storage policies also reject writes for a pending account.
4. Every object under `avatars/<auth-user-id>/` is enumerated recursively and in pages of 100,
   then removed in batches of 100. Missing objects are harmless on a retry.
5. The trusted server deletes that same Auth user with the Admin API. An already absent user is
   treated as success.
6. Storage is scanned again to close the small race with an upload already in flight.
7. `finalize_account_deletion_database()` runs the database repair and residual verification in
   one PostgreSQL transaction, then marks the job completed and clears its transient `user_id`.

If the request stops after Auth deletion, the user can no longer authenticate. An authenticated
Memora admin can invoke the server-only operational resume action with the job ID. There is no
background worker or pretend cron in this implementation.

### Trusted operator resume

Use only a trusted server checkout with the production server environment already injected. Never
paste the service-role key into the command line, a ticket, chat, or log.

1. Obtain the job UUID from the minimal operational job log; do not search by email or username.
2. Confirm that the job is retryable and record its safe `resume_step` and attempt count.
3. Run `npm run account-deletion:resume -- --job-id <job-id>` once.
4. Run the same command once more. `Account deletion status: completed` is the expected
   idempotent result; any other outcome requires investigation rather than a manual status update.
5. Confirm that Auth, the avatar prefix, public rows, and private rows are absent before closing the
   incident.

The CLI prints only the final status. It does not print the user ID, email, Storage paths, provider
errors, tokens, or stack traces. The authenticated server action is a separate path: it derives the
caller from the JWT and requires a confirmed `admin` role before invoking the same coordinator.

## Database ownership graph

The current schema uses `ON DELETE CASCADE` from `auth.users` for these direct user roots:

| Area             | Direct user-owned rows                                                                        | Dependent rows removed transitively                     |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Profile          | `profiles`, `profile_private`, `user_roles`                                                   | friendships and creator follows that reference profiles |
| Learning content | `decks`, `collections`                                                                        | cards and collection links                              |
| Marketplace      | user likes, saves, ratings, reports, copies, follows                                          | deck/collection-owned marketplace rows                  |
| Study            | progress, associations, settings, delayed recall, last studied, streaks, sessions, speed runs | session cards, questions, options, and events           |
| AI               | usage events and rate-limit rollups                                                           | none                                                    |
| Private helpers  | content-creation idempotency requests and default-collection mappings                         | none                                                    |

Copied decks and collections use `SET NULL` for source references where preservation is intended;
deleting the source owner must not delete another user's copy. The finalizer repeats targeted
deletes only as an idempotent legacy repair, then checks every current user-linked table. A job is
not completed if Auth, Storage, public rows, or private rows remain.

When adding a new user-owned table, developers must add an explicit Auth/user foreign key with the
correct deletion action, extend `account_deletion_residual_count`, extend the finalizer only if a
legacy repair is needed, and add SQL plus integration coverage. Never rely on a frontend-only
delete list.

## Authorization and mutation blocking

- Public clients cannot read or update `private.account_deletion_jobs`.
- `request_account_deletion()` accepts no user ID and uses `auth.uid()`.
- Claim, transition, failure, finalization, and retention RPCs are service-role-only.
- Normal server functions use `requireSupabaseAuth`, which rejects an account with a pending job.
- Database statement triggers also block authenticated writes across user-mutating public tables.
- Avatar policies reject authenticated insert, update, and delete while deletion is pending.

The UI block is only a usability measure. The middleware, database, and Storage policy checks are
the security controls.

## Safe errors and retries

Clients receive only stable messages for authentication failure, an in-progress deletion,
retryable interruption, terminal failure, or an already deleted account. Raw PostgreSQL errors,
constraint names, Storage paths, Admin API details, stack traces, and credentials are not returned.

Temporary Storage, network, Auth Admin, and database errors are retryable. Invalid job ownership
and exhausted attempts are terminal. Operational logs may contain the job ID, state, attempt count,
timestamps, latency, and a safe error code. They must not contain email, username, JWTs, secrets,
card text, or complete Storage paths.

## Reauthentication

The current release requires a valid Supabase session and explicit `DELETE` confirmation. It does
not claim to provide universal recent reauthentication. Password and OAuth accounts need different
provider-supported reauthentication flows, and Memora must not emulate password verification.
Adding a reliable recent-session or provider reauthentication gate is a future defense-in-depth
improvement; it must not change SMTP or Resend settings as part of this workflow.

Deletion is a `POST` server action with a strict request schema. Authentication comes from an
explicit Bearer access token, not an ambient cross-site cookie, so another origin cannot submit the
user's session through normal browser CSRF behavior. The server validates the token and derives the
user ID from it; the confirmation string is an intent check, not an authentication credential.

## Local data

After completion the browser signs out locally, clears `localStorage` and `sessionStorage`, and
replaces the current page with the public home page. This removes study caches, drafts,
preferences, and pending client idempotency keys held by the application.

## Retention and operations

Completed jobs retain only pseudonymous operational metadata for 30 days. Terminal jobs retain
diagnostic metadata for 90 days. The SHA-256 user reference is derived from a random Auth UUID and
an application namespace; it is not an email or username. `purge_expired_account_deletion_jobs()`
is service-role-only and should be called by a trusted scheduled operation or an explicit operator
procedure. The completed-job retention must remain longer than the maximum Supabase access-token
lifetime, because the retained hash blocks stale JWTs. No scheduler is created by this migration.

Before production rollout, the reviewer must record the production Auth **JWT expiry limit** from
Supabase Authentication > Sessions. The 30-day completed retention may be used only when that
verified limit is shorter than 30 days; otherwise increase retention before applying the migration.
This check is intentionally a rollout gate rather than an inferred default.

For a retryable job whose Auth user is gone, an operator should verify the safe status, invoke the
admin-only resume action once, and confirm `completed`. Do not manually mark a job completed or
delete it before residual verification succeeds.

No automatic retry scheduler is installed. The UI reports an interruption as incomplete and lets
the still-authenticated owner retry; after Auth deletion, a trusted operator must resume the job.
A future operational task must add a trusted scheduler/operator runner for retryable jobs, invoke
the service-only retention purge for completed jobs after 30 days and terminal jobs after 90 days,
and alert on attempt exhaustion. That task must preserve the same lease and verification rules.
