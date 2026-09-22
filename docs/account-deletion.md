# Account deletion security

## Transaction boundary

Memora does not describe account deletion as one distributed transaction. PostgreSQL can
atomically update database rows, but Supabase Storage and Supabase Auth are separate services.
The deletion workflow therefore uses durable state, idempotent steps, a lease, and final
verification. A failure is either resumable or recorded as a terminal operational failure; it
must not be reported as success while the checked residuals remain. The finalizer verifies
SQL-visible residuals, not every physical provider byte. Production completion guarantees remain
conditional on the unverified hosted cleanup/lifetime gates below.

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
4. `capability_drain_pending` / `capability_drain`
5. `database_verification_pending` / `database_verification`
6. `completed` / `done`

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
6. SQL verifies Auth absence and persists `capability_drain_started_at` and
   `capability_drain_until` using the database clock, exactly 25 hours apart. The lease is
   released. Waiting is not completion, does not hold a worker, and consumes no attempts.
7. At/after the deadline a new leased attempt cleans Storage through the API again. The commit
   fence rejects late signed/admitted metadata writes, while provider cleanup may still be in
   progress. Multipart metadata is inspected read-only; remaining uploads/parts block completion.
8. `finalize_account_deletion_database()` independently checks the deadline and SQL-visible provider metadata,
   then runs the database repair and residual verification in
   one PostgreSQL transaction, then marks the job completed and clears its transient `user_id`.
   It does not inspect backing-store bytes, TUS internal parts, cleanup queues, caches or backups.

If the request stops after Auth deletion, the user can no longer authenticate. An authenticated
Memora admin can invoke the server-only operational resume action with the job ID. There is no
background worker or pretend cron in this implementation.

### Trusted operator resume

Use only a trusted server checkout with the production server environment already injected. Never
paste the service-role key into the command line, a ticket, chat, or log.

The CLI requires both `--expected-project-ref` and `--job-id` (in either order). It rejects
missing, repeated, unknown arguments (including `--dry-run`), extra values and invalid ref/UUID
formats before creating a client. Runtime validation rejects project mismatches, noncanonical
URLs and invalid credential shapes before any request. The backend uses the same validated
URL/key snapshot. This remains shape-only: it does not verify signatures, permissions or the
project binding of opaque keys. Importing the module does not run the CLI.

1. Obtain the job UUID through trusted read-only inspection of the private job table; select
   only id, status, resume_step, attempt_count, last_error_code and timestamps, never user data.
2. Inspect `capability_drain_until`, `next_retry_at`, the safe `resume_step`, and attempt count.
   Schedule an operator follow-up at/after the deadline; there is no automatic runner.
3. Run `npm run account-deletion:resume -- --expected-project-ref <expected-ref> --job-id <job-id>` once.
4. `Account deletion status: capability_drain_pending` is expected before the deadline.
   Do not poll continuously. After a successful post-drain run, repeating the command returns
   `Account deletion status: completed` idempotently. Other outcomes require investigation,
   never a manual assignment of `completed`.
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
deletes only as an idempotent legacy repair, then checks the current SQL residual inventory. A job
is not completed if the checked Auth, Storage metadata, public or private rows remain. Empty SQL
inventory is not proof that all provider bytes have been physically removed.

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

## Separate production rollout gates

This local remediation and green CI are not production approval. Merge approval and production
deployment authorization are separate. Before any merge, an approved rollout plan must establish
how automatic production deployment is held until the database prerequisites are verified.
Do not assume GitHub/Vercel integration already provides that separation.

Before any separately authorized rollout:

1. Independently review the revised migration and matching application commit; keep PR #10 Draft.
2. Attest historical JWT validity plus leeway is shorter than the 30-day tombstone retention.
3. Confirm the actual hosted version/backend, transaction behavior, COMMIT-failure compensation,
   queue and cleanup bounds, REST/signed/TUS/S3/multipart and abort races, admitted-stream limits,
   elevated writers and cross-bucket moves. Confirm this deferred trigger's compatibility with
   managed migrations; permission to create custom triggers is not that compatibility evidence.
4. Assign an operator and follow-up queue for **every** deletion after its drain deadline,
   not only exceptional failures. Provide approved server-only resume access and a terminal-job
   escalation procedure. Without that operational ownership, production rollout is NO-GO.
5. Verify Vercel runtime, effective `maxDuration`, server-only configuration and the approved
   operator runtime. The 120-second coordinator deadline and 15-second network timeout do not
   prove the platform permits the attempt or guarantees external request cancellation.
6. After a separately authorized production preflight, apply and verify only
   `20260916010000_atomic_account_deletion.sql` before deploying matching middleware/coordinator code;
   the application calls `is_account_deletion_pending()` and fails closed if it is missing.
7. Only then deploy under separate authorization, execute smoke tests under an independently
   approved temporary-data/cleanup plan, and monitor jobs/residuals. No destructive production
   fixtures are authorized by this document.

If application deployment fails after migration, preserve fences, jobs and tombstones and repair
the matching deployment. Rollback may select only a build compatible with the new deletion
workflow, including capability-drain states. Never return to the legacy deletion flow or drop
the database protections to make an older build work.

Public avatar URLs may remain accessible during the drain or provider cache retention. A pending
job is not a claim that all copies/bytes have already disappeared.

Deletion is a `POST` server action with a strict request schema. Authentication comes from an
explicit Bearer access token, not an ambient cross-site cookie, so another origin cannot submit the
user's session through normal browser CSRF behavior. The server validates the token and derives the
user ID from it; the confirmation string is an intent check, not an authentication credential.

## Local data

After Auth deletion the browser signs out locally and clears `localStorage` and `sessionStorage`.
During capability drain it displays an explicit incomplete-cleanup notice and a Continue button
to the public page. It does not promise automatic completion. Completed replies redirect straight
to the public page. This removes study caches, drafts,
preferences, and pending client idempotency keys held by the application.

## Retention and operations

Completed jobs retain only pseudonymous operational metadata for 30 days. Terminal jobs do NOT
expire: they retain the transient identity and tombstone until an audited recovery completes.
The purge RPC selects only `completed`, verified, identity-cleared jobs. Even a legacy terminal
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
Auth settings were changed during Stage 3. The previously supplied production setting records
current issuance of **3600 seconds** and no custom access-token hooks; this local pass made no
production configuration reads. Alternate issuers/legacy signing paths still need attestation.
Thirty days is 720 hours, exceeding current issuance by **719 hours**, before clock
skew. Historical/legacy JWT maximum lifetime plus acceptance leeway still requires operator
attestation before rollout; current configuration is not evidence about old outstanding JWTs.

For a retryable job whose Auth user is gone, an operator should verify the safe status/deadline,
invoke the admin-only resume action after the drain, and confirm `completed`. Do not manually mark a job completed or
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

## Operator runbook

The following are **future authorized operator commands**, not commands to execute during this
local task. Run them only in the approved server/operator environment; do not copy keys into
arguments, logs, screenshots or shell history.

Offline environment inspection (no network):

```sh
node --experimental-strip-types scripts/check-account-deletion-runtime.ts --expected-project-ref <expected-ref>
```

This checks canonical HTTPS server URL/project identity and backend credential shape only.
It rejects missing/malformed/anon legacy keys and explicit project mismatches. It does not
verify signatures, modern opaque-key project binding, network health, permissions or deployment
configuration. A shape-only PASS is not permission to apply a migration or run deletion.

Read-only operator inventory (one bounded page, no claim/resume):

```sh
node --experimental-strip-types scripts/list-account-deletion-jobs.ts --expected-project-ref <expected-ref>
node --experimental-strip-types scripts/list-account-deletion-jobs.ts --expected-project-ref <expected-ref> --after-job-id <last-job-id>
```

`list_account_deletion_attention` is service-role-only, STABLE and SELECT-only. It exposes only
job ID, safe status/step, attempts, next retry, age and safe error code. It omits completed jobs,
active leases and future successful drain waits. Failed/backoff jobs remain visible for diagnosis.
Pages are ordered by job UUID; repeat a scan from the start periodically since new random UUIDs
can precede a prior cursor. The listing does not surface user UUIDs, hashes, paths or provider errors.

| Situation | Required operator procedure |
| --- | --- |
| Retryable job | Inspect safe status/step/backoff. Resolve cause. Wait for retry/deadline and expired lease; invoke `npm run account-deletion:resume -- --expected-project-ref <expected-ref> --job-id <job-id>` once, then list/status-check again. Never force `completed`. |
| Failed terminal | Stop automatic attempts. Record a recovery decision, inspect residuals privately, fix root cause, then separately authorize a narrowly scoped transaction to reset the attempt cycle/backoff and expired lease. Preserve identity/hash/step/drain timestamps. Resume normally; never purge unresolved jobs. |
| Auth already deleted | Do not re-create user or use a stale owner session. Use the server job ID and service-only coordinator. Missing Auth is idempotent; still wait for drain and residual verification. |
| Storage object residual | Coordinator re-enumerates owner/prefix metadata in batches of 100 and deletes via Storage API. Fix provider outage then resume. Never SQL-delete managed rows. |
| Multipart residual | Keep incomplete with `PROVIDER_RESIDUAL`. Privately confirm owner/key/parent-part linkage. Using separately approved existing credentials and supported S3 tooling, abort only matched uploads, bounded one batch at a time. Re-list after partial failures. If completion occurred, also obtain provider confirmation of rejected-version byte cleanup. Do not infer this from successful abort or empty SQL metadata. No bulk prefix deletion or new credentials in this change. |
| Abort/termination fails | Do not disable the fence or add a service-role exemption. Escalate with safe job ID/version/error category to provider support; retain evidence/tombstone and incomplete status. |
| Migration applied, app deploy failed | Keep migration/fences in place. Do not expose the old destructive deletion action to users; pause rollout and repair the matching application deployment. Existing jobs require the reviewed operator build. |
| App deployment rollback | Roll back only to a deletion-aware compatible build. An older coordinator cannot understand drain states. Do not drop RPCs/fences or restart legacy delete-by-table behavior; disable deletion entry operationally until the matched build is restored. |
| Expired completed tombstone | Confirm historical JWT maximum acceptance plus skew is below retention and provider drain/cleanup prerequisites remain valid. Only then use the service-only purge. Never purge failed/pending jobs or shorten timestamps to force completion. |

No automatic retries or alerts were added. An assigned operator must review due jobs at least
daily, including the first post-drain pass, and escalate terminal/provider-residual jobs. This is
acceptable only with explicit operational ownership; without it production rollout is blocked.

## Stage 3.1 fence and capability drain

The unapplied `20260916010000_atomic_account_deletion.sql` is revised in place.
Shipped Stage 1 and Stage 2 migrations are unchanged; Stage 2 keeps namespace `52017002`.
The avatar metadata fence is retained locally, with namespace `52017003`. It is now an
AFTER ROW constraint trigger, DEFERRABLE INITIALLY DEFERRED. This permits Storage's
rolled-back permission probes (including abort/termination), but rejects real metadata
commits for pending or absent Auth identities, including elevated finalizers. There is no
service-role or request-header bypass. RLS still rejects fresh ordinary uploads.

Custom triggers on `storage.objects` are explicitly permitted by the
[hosted permissions announcement](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025).
That does not guarantee this particular lifecycle integration or provider byte cleanup.
**Production remains NO-GO** pending provider/runtime confirmation. The detailed protocol
matrix, alternatives and multipart lifecycle evidence are in [account-deletion-storage.md](account-deletion-storage.md).
Application SQL reads managed metadata; it never inserts, updates or deletes Storage rows.

### Lifetime assumptions and evidence

The reviewed default is **25 hours after SQL verifies Auth absence**, not after request creation.
It is a conservative capability drain, NOT immediate revocation or a distributed transaction.

| Capability | Documented lifetime | Source |
| --- | --- | --- |
| Signed upload URL | 2 hours | [Supabase JS documentation](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl) |
| TUS upload URL | up to 24 hours | [Resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) |
| S3 multipart | automatically aborted after 24 hours | [S3 uploads](https://supabase.com/docs/guides/storage/uploads/s3-uploads) |
| Current access JWT issuance | 1 hour | Prior production read-only Auth configuration review; historical maximum remains unverified |

Public upstream Storage **v1.77.5** source was reviewed at commit
[`2f89775ead04da4b681da3b15d39f129366719ac`](https://github.com/supabase/storage/tree/2f89775ead04da4b681da3b15d39f129366719ac)
in the original **2026-09-17** source audit. It was not run or identified as the hosted version.
Local protocol tests used **v1.66.4**; the actual deployed hosted version/backend is unconfirmed:
- [TUS lifecycle](https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/tus/lifecycle.ts):
  `onIncomingRequest` checks signed `x-signature` on each signed request, and ordinary
  requests run `canUpload`. A signed TUS initiation does not remove subsequent signature checks.
- [TUS routes](https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/tus/index.ts):
  S3-store URL expiration uses provider configuration. The local file store is NOT proof of
  hosted S3 garbage collection or hosted timeouts.
- [Uploader](https://github.com/supabase/storage/blob/v1.77.5/src/storage/uploader.ts):
  admission precedes streaming; completion writes elevated metadata. RLS does not revoke an
  already-admitted stream or signed capability.
- [S3 handler](https://github.com/supabase/storage/blob/v1.77.5/src/storage/protocols/s3/s3-handler.ts):
  completion finalizes the object and then deletes multipart metadata; abort is a provider API.
- [Database adapter](https://github.com/supabase/storage/blob/v1.77.5/src/storage/database/pg.ts):
  upload and part rows are provider-owned, not Auth-cascaded.

Twenty-five hours includes a one-hour margin above the largest documented capability window.
**Rollout invariants:** issuance/acceptance windows must remain bounded as above, new normal
mutations must remain blocked, provider in-flight byte writes/cleanup must fit the drain,
provider clocks/leeway must fit the margin, and no writer may bypass metadata triggers.
Capability expiry alone does not cancel an already-running request.
The database cannot observe unfinalized backend bytes. An indefinitely admitted upload or
arbitrarily delayed provider finalization would invalidate any finite wait. Before production
rollout, the operator/provider must attest those bounds; this local implementation is not proof
of hosted behavior. Retained provider backups, CDN caches and garbage-collection queues have
their own policies. Do not describe metadata absence as guaranteed physical erasure from backups.

### Multipart inventory and supported handling

In the reviewed public upstream Storage v1.77.5 source (not an attested hosted schema):
- `storage.s3_multipart_uploads`: text `id`, text `owner_id`, `bucket_id`, `key`,
  `version`, upload signature, timestamps/metadata; bucket FK, **no Auth FK**.
- `storage.s3_multipart_uploads_parts`: UUID id, text `upload_id`, text `owner_id`,
  bucket/key/version, part number/size/etag; parent FK to uploads.id **ON DELETE CASCADE**,
  bucket FK, **no Auth FK**.

`private.account_deletion_provider_residual_count(uuid)` counts avatar objects, upload parents
matching owner_id OR canonical UUID key prefix, and parts matching their own owner/key OR any
matching parent. This covers owner-matched legacy keys and NULL part owners transitively.
Unrelated owners' uploads are never selected or deleted. The finalizer and full residual inventory
both use this helper; it is not executable by public clients.

No app SQL directly inserts, updates or deletes managed Storage metadata. Objects are removed
through Storage API in bounded batches. Remaining multipart state yields safe `PROVIDER_RESIDUAL`,
a one-hour retry backoff and no completion. Exhaustion preserves a terminal job/tombstone for
operator action; it is never silently purged. No completion is inferred from TTL expiry.
An operator may use supported `AbortMultipartUpload` only after proving ownership and having
separately approved existing credentials. The deferred fence allows the abort permission probe
to roll back without allowing a real object commit. This change does not provision credentials
or add a production S3 client. An aborted already-completed upload can lose multipart bookkeeping
without proving its completed backend bytes were deleted; require provider cleanup verification.

Local tests exercise CreateMultipartUpload, UploadPart, CompleteMultipartUpload and AbortMultipartUpload through the
provider's bundled AWS SDK using disposable local credentials. They verify parent/part residue,
blocked completion, partial abort/resume, unrelated-user isolation and successful retry. SQL fixture inserts are local
transactional models only, rolled back; application/migration code never performs multipart DML.

### Protocol usage and unrestricted keys

Memora's shipped source uses ordinary `storage.from("avatars").upload(...)` in
`src/routes/profile.tsx`, public URL retrieval, and Storage API removal in the coordinator.
It does **not** use S3, TUS, createSignedUploadUrl or uploadToSignedUrl in application code.
The account-deletion integration fixtures deliberately exercise those alternate capabilities.

S3 being enabled still permits JWT-backed S3 requests without generated keys.
[Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)
documents that generated unrestricted S3 keys bypass RLS. The rollout invariant is:
**no generated unrestricted S3 access keys capable of writing avatar paths outside application
controls**. The prior operator observation was zero generated keys; this task does not re-read
or change production. Creating a key later, adding new elevated writers, changing capability
lifetimes, or upgrading provider lifecycle behavior requires a security re-review.

### RLS, commit fence and deterministic testing

Avatar INSERT/UPDATE/DELETE policies block a pending/tombstoned authenticated user. Signed uploads
and admitted streams cannot commit late metadata under the local fence. Tests inspect real
provider responses and local byte cleanup, not only row absence. Stale JWTs remain blocked by
middleware, application-table triggers, Auth/FK checks and Storage policies/fence.

Local time travel changes only guarded disposable job timestamps while preserving the exact
25-hour interval. No production RPC accepts a clock override or permits a shortened window.
Actual provider token expiry is NOT accelerated by those fixtures. A still-valid signed URL is
replayed after simulated completion/purge to test the independent missing-Auth fence, not expiry.

### Evidence update: 5fc0cf8 (2026-09-20)

Reviewed artifact: `5fc0cf843932a9c6af01fe3cf89766ebae6df64a`, based on main
`6e9af59b1fe20b7e769c6995254c684172cd9d3c`. PR #10 remains Open/Draft. This is an
addendum, not a replacement for the original 2026-09-17 source audit and historical **14/14**
local result in [the Storage evidence document](account-deletion-storage.md).

For this SHA, the [account-deletion static/build logs](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697298/job/105960229039)
show static audit, **58/58** unit tests (including **11** offline Docker guard tests), typecheck,
scoped ESLint, Nitro/Vercel build and the configured browser-output marker scan passing.
The [integration logs](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697298/job/105960228931)
show Storage **v1.66.4**, **16/16** account-deletion integration tests with no skips,
**423/423** SQL assertions across seven files, database lint, Stage 1/2 regressions and the
Stage 2-to-Stage 3 upgrade rehearsal passing. These are recorded CI runs, not tests rerun by
this documentation update. All five workflows (ten Actions jobs) succeeded, and the
[Vercel Preview check](https://vercel.com/yelzhas-tem-s-projects/word-ace-deck/CLr57jhNT4Wf91P6qX9XCZ7Z72YE)
reported success. Preview/build success does not establish production runtime readiness.

The two added tests use separate metadata/request sessions and an observer, the actual fence
and `request_account_deletion()`, and namespace `52017003`:

- **Metadata-first:** `SET CONSTRAINTS storage.account_deletion_avatar_fence IMMEDIATE` executes
  the real deferred trigger while the metadata transaction remains open. Its shared lock blocks
  the request's exclusive lock. Real metadata COMMIT releases it, then the request publishes
  its job on COMMIT; the leased avatar inventory includes the committed object. This proves
  lock ordering, **not default deferred-trigger timing** for this ordering.
- **Deletion-first:** no `SET CONSTRAINTS` override. INSERT succeeds, then the real COMMIT runs
  the default deferred fence and waits for the request's exclusive lock. After request COMMIT,
  fresh pending state causes `ACCOUNT_DELETION_STORAGE_FENCED`; metadata rolls back and no
  object remains. The test checks the failed psql COMMIT exit as well as rows and released locks.
- The observer compares specific backend PIDs, the hash key's `classid`/`objid`/`objsubid`,
  database, ShareLock/ExclusiveLock mode, granted/waiting state, `pg_blocking_pids` and blocked
  RPC/COMMIT statement. Bounded catalog polling, not elapsed sleeps, establishes ordering.
  Finally blocks close all fixture sessions and verify their locks and synthetic rows are gone.

These two tests insert synthetic metadata with **no provider bytes**. They prove neither hosted
protocol behavior nor physical byte deletion at `completed`. Provider-byte/compensation/race
gates remain open; browser verification of the pending notice after sign-out also remains open.

## Bounded work and leases

Successful Auth-to-drain handoff refunds its successful attempt, releases the lease, and persists
the absolute deadline. Early claims return pending before attempt/backoff processing, with no
job write or attempt increment. The first claim at/after the deadline atomically claims a fresh
verification lease; concurrent claims cannot mix work. Eight actual work attempts remain the
ceiling, including crashed attempts; a successful handoff is not treated as a failure. The
finalizer independently rejects a future/missing drain deadline. Restarting a process does not
restart or shorten the database deadline. An expired worker cannot advance into drain.

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
| Read-only provider residual; supported abort and verification | storage.s3_multipart_uploads and storage.s3_multipart_uploads_parts; no Auth FK; TTL alone is not proof |
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
printing credentials. The fixture guard rejects non-loopback URLs before constructing clients.
The shared account-deletion DB helper resolves an explicit `DOCKER_CONTEXT` by name, otherwise
uses implicit metadata inspection, validates a canonical existing Unix socket, and pins that
endpoint/environment for SQL, session startup and cleanup. Offline mocks test this contract,
not Docker CLI behavior; do not generalize this helper's guard to every other Docker fixture.

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
