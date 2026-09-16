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
4. `list_account_deletion_avatars(job, lease)` reads at most 100 object names from Storage
   metadata, including nested names and owner-matched legacy paths outside the UUID prefix.
   The Storage API deletes that batch before reading the first page again. No offset shifts,
   unbounded hierarchy, or full-file inventory is held in memory. Missing files are harmless.
5. The trusted server deletes that same Auth user with the Admin API. An already absent user is
   treated as success.
6. Storage is scanned again for repair; the metadata write fence below, not this scan, closes
   the in-flight metadata race.
7. `finalize_account_deletion_database()` runs the database repair and residual verification in
   one PostgreSQL transaction, then marks the job completed and clears its transient `user_id`.

If the request stops after Auth deletion, the user can no longer authenticate. An authenticated
Memora admin can invoke the server-only operational resume action with the job ID. There is no
background worker or pretend cron in this implementation.

### Trusted operator resume

Use only a trusted server checkout with the production server environment already injected. Never
paste the service-role key into the command line, a ticket, chat, or log.

1. Obtain the job UUID through trusted read-only inspection of the private job table; select
   only id, status, resume_step, attempt_count, last_error_code and timestamps, never user data.
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

Completed jobs retain only pseudonymous operational metadata for 30 days. Terminal jobs do NOT
expire: they retain the transient identity and tombstone until an audited recovery completes.
Automatic purge selects only `completed`, verified, identity-cleared jobs. Even a legacy terminal
row with an expired retention timestamp is retained. The SHA-256 reference is derived from a random Auth UUID and
an application namespace; it is not an email or username. `purge_expired_account_deletion_jobs()`
is service-role-only and should be called by a trusted scheduled operation or an explicit operator
procedure. The completed-job retention must remain longer than the maximum Supabase access-token
lifetime, because the retained hash blocks stale JWTs. No scheduler is created by this migration.

Before production rollout, the reviewer must record the production Auth **JWT expiry limit** from
Supabase Authentication > Sessions. The 30-day completed retention may be used only when that
verified limit is shorter than 30 days; otherwise increase retention before applying the migration.
Include custom access-token hooks and the maximum expiry of tokens issued under prior settings,
plus clock skew/safety margin. Session inactivity/time-box limits and refresh-token rotation are
not substitutes for access JWT expiry. This remains an unverified rollout gate; no production
Auth settings were read or changed during Stage 3.

For a retryable job whose Auth user is gone, an operator should verify the safe status, invoke the
admin-only resume action once, and confirm `completed`. Do not manually mark a job completed or
delete it before residual verification succeeds.

No automatic retry scheduler is installed. The UI reports an interruption as incomplete and lets
the still-authenticated owner retry; after Auth deletion, a trusted operator must resume the job.
A future operational task must add a trusted scheduler/operator runner for retryable jobs, invoke
the service-only retention purge for verified completed jobs after 30 days,
and alert on attempt exhaustion. That task must preserve the same lease and verification rules.

An exhausted job cannot be resumed by silently increasing its attempt limit in application code.
An operator must inspect the preserved step/residue, resolve the cause, and record a recovery
decision before a narrowly scoped service-side requeue (reset the attempt cycle, retain the
identity/hash, clear expired lease/backoff, never assign `completed`). There is no automatic
terminal archival or purge. Unresolved jobs therefore require an operational follow-up policy.

## Stage 3 forward migration and Storage fence

The never-deployed old migration was replaced by
`20260916010000_atomic_account_deletion.sql`, after the shipped Stage 1 and Stage 2 migrations.
Neither shipped migration is modified. Stage 2 retains advisory namespace `52017002`.

Supabase CLI **2.110.0** runs local Storage **v1.66.4**, image digest
`sha256:ead6d49b9873d65a030c6c44b46676f4276b234becd6d7819c254351b5400d95`.
Its `uploader.js` checks permission before receiving the file, then calls
`db.asSuperUser().upsertObject` in `completeUpload`. `uploadSignedObject.js` also uses an
elevated client. RLS alone cannot fence either path.

`account_deletion_avatar_fence` is a BEFORE INSERT/UPDATE trigger on `storage.objects` for
avatars, not a replacement for provider functions. It derives identities from owner_id and
old/new UUID prefixes, acquires shared transaction locks in UUID order in namespace `52017003`,
and rejects pending/tombstoned or missing Auth identities. Deletion request takes the exclusive
counterpart before recording the job. A metadata transaction already admitted must commit first;
a later finalization sees the job. READ COMMITTED is required for a fresh post-lock snapshot;
other isolation levels fail closed. Service/elevated writes are intentionally not exempt.

Missing Auth checks persist after completed tombstones expire. A signed capability therefore
cannot resurrect avatar metadata even after purge; this protocol does not wait for or guess its
TTL. Real local tests replay pre-issued signed upload URLs while pending, completed and purged,
and hold a pre-authorized stream across completion. Kong buffers bodies, so the stream test
reaches the actual local Storage listener inside its Docker container. It checks both rejected
metadata and removal of rejected bytes by the provider's ObjectAdminDelete cleanup.

The blob backend is still outside PostgreSQL. Provider cleanup queues, caches/backups, and
failure/retry behavior of provider garbage collection are not transactional guarantees. Before
rollout, independently verify the production Storage version, finalization trigger compatibility,
enabled upload protocols (including signed/TUS/S3 if exposed), and failed-upload cleanup. Record
capability lifetimes; TTL itself is not the fence's safety assumption, but this local verification
is not proof of production behavior. Do not deploy until provider compatibility is approved.

## Bounded work and leases

One Storage pass handles at most 50 batches of 100 names. A 120-second coordinator deadline and
15-second per-network-operation timeout bound a server attempt. Deletion of a batch is persisted
progress; retries enumerate remaining names without storing paths in the job. Very large accounts
may need several attempts or audited operator recovery after eight attempts. Renew, advance,
failure recording and finalization require the current unexpired lease token. A stale worker
cannot renew or modify a successor's state. External requests cannot be recalled after dispatch;
their effects are target-scoped and idempotent, and a post-operation checkpoint prevents false
completion if the lease/deadline elapsed.

## Combined-schema coverage

All following user-associated roots cascade on Auth deletion and are included in residual
verification plus narrowly scoped legacy repair. The SQL catalog test fails when a new user-link
column appears without inventory coverage.

| Classification | Tables / locations |
| --- | --- |
| Auth cascade; explicit repair | profiles, profile_private, user_roles, decks, collections |
| Parent/composite-owner cascade; repair | cards, collection_decks |
| Either profile endpoint cascade; repair | friendships, creator_follows |
| User/resource cascade; repair | deck_likes, deck_saves, deck_ratings, deck_reports |
| User/resource cascade; repair | collection_likes, collection_saves, collection_ratings, collection_reports |
| Auth/parent cascade; repair | card_progress, card_associations, deck_learning_settings, delayed_recall_entries, last_studied_decks, streak_days |
| Auth/parent cascade; repair | study_sessions, study_session_cards, study_questions, study_events, speed_runs |
| Question cascade; no separate user identity | study_question_options |
| Auth cascade; repair | ai_usage_events, ai_rate_limit_rollups |
| Auth cascade; repair | private.content_creation_requests, private.user_default_collections, private.marketplace_view_receipts |
| Intentionally retained | other users' copied decks/collections/cards; source references SET NULL |
| No user ownership, retained | ai_runtime_config, ai_endpoint_policies, storage.buckets |
| Explicit Storage API removal | avatars matching UUID prefix OR owner_id, all nested paths |
| Operational retention | private.account_deletion_jobs; hash only after verified completion |
| Provider-managed | Auth identities/sessions/refresh tokens via Admin deletion; provider audit logs/backups follow provider policy |

Stage 1 like/rating triggers continue to reconcile surviving resources during cascade; cumulative
view/copy counters intentionally do not become a current-user count. Marketplace receipts are
also guarded against pending callers. Stage 2 replacement is tested in both orderings: an admitted
replacement transaction delays Auth cascade until it commits; a pending-first replacement fails
without changing links. Deletion does not claim to share the collection advisory lock.

Fresh app actions (AI included) are blocked by the shared middleware; direct writes, study RPCs,
marketplace RPCs and copy/create paths are guarded by database statement triggers and existing
FKs. Already admitted AI provider work can finish; no distributed cancellation is promised.
GoTrue account/password/session APIs are provider-owned, not all frozen by app middleware while
the Auth row still exists. Recent reauthentication remains a separate security approval decision.

## Local validation commands

Use only a disposable local CLI stack, never `--linked`. Export local `.env.security` without
printing credentials. The fixture guard rejects non-loopback URLs before constructing clients;
Docker fault injection uses the local container socket and refuses remote DOCKER_HOST values.

```sh
supabase db reset --local
supabase db lint --local --level warning
supabase test db
npm run check:account-deletion
node --env-file=.env.security --experimental-strip-types scripts/verify-account-deletion.ts
node --env-file=.env.security --experimental-strip-types --test tests/account-deletion-integration.test.ts
ACCOUNT_DELETION_RESET_LOCAL=true node --env-file=.env.security scripts/verify-account-deletion-upgrade.mjs
```

Upgrade rehearsal resets only the local database to Stage 2, seeds synthetic data, applies only
Stage 3, verifies content/constraints and Stage 1/2 RPCs/privileges, then cleans its fixtures.
Type generation uses `supabase gen types typescript --local`; retain the established nullable RPC
annotations because pg-meta does not infer nullable function arguments/OUT columns.
