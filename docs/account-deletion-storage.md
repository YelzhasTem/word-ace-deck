# Account Deletion: Storage Evidence and Rollout Gates

## Scope and decision

- Research baseline: public Supabase Storage **v1.77.5**, commit **2f89775ead04da4b681da3b15d39f129366719ac** ([tag tree][tag], [immutable tree][commit]); official documentation reviewed 2026-09-17.
- Historical local account-deletion integration suite **14/14 passed**, including protocol tests against Storage **v1.66.4**; **v1.77.5 is source-reviewed only, not run**. The actual deployed hosted version/backend is unconfirmed. This original result is preserved; subsequent CI evidence is recorded separately below.
- This research made no production requests, inspected no credentials, and changed no implementation. Existing local implementation was read for review only.
- **Production remains NO-GO** until version-matched lifecycle tests and provider confirmation cover commit failures, admitted streams, cancellation, and physical cleanup bounds.
- Keep fail-closed `PROVIDER_RESIDUAL` handling. Do not add a production S3 adapter, provision keys, or mutate managed Storage rows through application SQL. Operator cleanup uses only an approved existing credential and supported API.

## Historical local evidence: v1.66.4

The original local integration suite completed at **14/14 passing**. Its protocol results validate only that v1.66.4 runtime/backend, not the unconfirmed hosted runtime:
- Multipart API abort succeeds after pending state and after Auth is gone. Elevated CompleteMultipartUpload after pending state rejects final metadata; parent and part rows remain until API abort. The attempted object's local file-provider bytes were observed at zero.
- Partial-abort handling with two owned uploads and one other user's upload preserves unrelated-user isolation.
- Normal TUS creation/PATCH works; a stale-user PATCH after pending state is rejected; server-side DELETE termination works. This does not claim that the blocked user can terminate with the same stale JWT, or that signed TUS was tested.
- Signed REST and already-admitted REST uploads are fenced. The reported cases support the deferred rollback-probe/real-commit distinction; overwrite side effects, failure injection, exact-target races and hosted cleanup bounds remain review gates.

## Evidence update: 5fc0cf8 (2026-09-20)

This addendum preserves the original **2026-09-17** source audit and **14/14** result above.
The independently checked local, remote and PR #10 head is
`5fc0cf843932a9c6af01fe3cf89766ebae6df64a`; main is
`6e9af59b1fe20b7e769c6995254c684172cd9d3c`. PR #10 is Open/Draft at this review.
The linked logs completed on 2026-09-19 UTC (2026-09-20 Asia/Almaty); this docs-only pass
did not rerun integration/reset, contact production or attest a hosted Storage version.

| Evidence for this SHA | Result and source | Limit |
| --- | --- | --- |
| Account-deletion static/build | **58/58** unit tests, including **11** Docker guard tests; static audit, typecheck, scoped ESLint, build and configured browser-output marker scan passed ([job logs](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697298/job/105960229039)) | Offline mocks check helper arguments/fail-closed behavior, not Docker CLI resolution; marker scan is not a production credential audit. |
| Account-deletion integration | **16/16**, zero failed/skipped; logs identify Storage **v1.66.4** ([job logs](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697298/job/105960228931)) | Disposable CI runtime, not hosted protocol/backend parity. |
| SQL and upgrade | **423/423** SQL assertions across seven files, database lint and Stage 2-to-Stage 3 upgrade rehearsal passed ([same job logs](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697298/job/105960228931)) | Synthetic local data; not production schema verification. |
| Other workflows | [Database integrity](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697320), [Profile privacy](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697306), [Study data integrity](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697325), [AI endpoint security](https://github.com/YelzhasTem/word-ace-deck/actions/runs/35466697288): all success | Five workflows / ten Actions jobs passed in total; not production rollout authorization. |
| Vercel Preview | GitHub Vercel check **SUCCESS** ([deployment check](https://vercel.com/yelzhas-tem-s-projects/word-ace-deck/CLr57jhNT4Wf91P6qX9XCZ7Z72YE)) | Not proof of hosted Storage, production `maxDuration`, environment credentials or browser flows. |

### Exact concurrency evidence

The [tests at the reviewed commit](https://github.com/YelzhasTem/word-ace-deck/blob/5fc0cf843932a9c6af01fe3cf89766ebae6df64a/tests/account-deletion-integration.test.ts)
exercise real trigger/RPC code with two transaction sessions plus an independent observer:

- **Metadata-first:** the INSERT initially leaves the constraint deferred. The test explicitly
  runs `SET CONSTRAINTS storage.account_deletion_avatar_fence IMMEDIATE`, executing the real
  trigger and retaining its shared lock. `request_account_deletion()` waits for exclusive.
  Metadata COMMIT succeeds, the request proceeds, then request COMMIT publishes the job.
  The committed object is found through the real leased `list_account_deletion_avatars` RPC.
  This proves lock ordering, **not default deferred timing** for metadata-first.
- **Deletion-first:** the real request retains exclusive while its job is uncommitted. INSERT
  succeeds; without any `SET CONSTRAINTS` override, real COMMIT invokes the default deferred
  trigger and waits for shared. Request COMMIT releases exclusive; a fresh pending-state read
  rejects metadata COMMIT with `ACCOUNT_DELETION_STORAGE_FENCED`. The test verifies psql exit 3,
  rollback, absence of the object, presence of the job and release of the locks.
- The observer verifies concrete backend PIDs, `hashtextextended(user_uuid::text, 52017003)`
  via the exact `classid`/`objid`/`objsubid`, database, ShareLock/ExclusiveLock, granted/waiting
  state, blocking PID, wait event and blocked RPC/COMMIT statement. It does not acquire a
  substitute lock to stand in for the implementation. Bounded catalog polling establishes the
  barriers. Finally cleanup checks those sessions, locks and synthetic fixtures are absent.

The CI log records metadata-first PIDs 660 (shared), 667 (exclusive waiter) and observer 674;
deletion-first PIDs 779 (exclusive), 772 (shared COMMIT waiter) and observer 786. These are
identifiers from that disposable run, not persistent production identities.

Both ordering tests use synthetic metadata with **no provider bytes**. They do not prove hosted
REST/signed/TUS/S3/multipart behavior or physical erasure by `completed`. The finalizer checks
SQL-visible residuals only. Physical provider-byte cleanup, compensation/queue bounds and a
browser check of the pending notice after sign-out remain validation gaps.

## Independent review: deferred commit fence

The proposed/local rewrite is `CREATE CONSTRAINT TRIGGER ... AFTER INSERT OR UPDATE ... DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`, retaining the function's pending-account and missing-Auth checks, with **no service-role, header, or cleanup exemption**.
The immediate BEFORE fence blocked S3 abort locally. The reported 14/14 local suite confirms successful abort and rejected real final metadata publication, without a service-role exemption. Local observations and v1.77.5 source evidence support this distinction; neither certifies hosted behavior.

1. `canUpload()` performs a real INSERT/UPSERT with placeholder version `1`; `testPermission()` deliberately throws its rollback sentinel. Rolled-back changes discard their deferred trigger events. RLS and other immediate constraints still apply. Therefore deferral removes this trigger's false rejection of abort, not every possible abort failure. [Preflight][preflight], [rollback probe][probe], [PostgreSQL timing][pg-trigger].
2. **v1.77.5 awaits actual COMMIT:** `StoragePgDB.withTransaction()` awaits `tnx.commit()` before returning, maps/rethrows failures, and only logs secondary rollback failures. `PgTransaction.commit()` awaits `runPgQuery(..., 'COMMIT')` and rethrows rejection. This is the `pg` adapter, not a hidden Knex transaction path. [Transaction wrapper][transaction], [COMMIT implementation][commit-code].
3. `Uploader.completeUpload()` uses `return await db.withTransaction(...)`; a deferred-trigger COMMIT error reaches its catch, which sends `ObjectAdminDelete` for the attempted version, then rethrows. The HTTP success path is not reached on this error. Queue dispatch failure can replace the original error, but does not turn it into success. [Finalization/catch][uploader].
4. **Nested-transaction caveat:** an existing parent transaction causes RELEASE SAVEPOINT, not COMMIT. A future caller wrapping finalization in an outer transaction would move deferred failure outside this catch. The reviewed REST, signed, TUS and ordinary S3 upload routes do not pass such a parent transaction; re-audit this invariant on upgrades. [Transaction wrapper][transaction].
5. **Pre-commit side-effect risk:** before the deferred fence runs, `completeUpload()` sends deletion of the previous version, emits the creation webhook, and records upload success. Those sends do not pass the object transaction as `tnx` and are not undone by COMMIT rejection. A rejected overwrite can retain old metadata while old bytes are deleted, or emit an event for a rejected object. For the deleting user's own pending avatar, deleting old bytes may match the desired outcome; this still is not transactional rollback. **No other-user data deletion was observed; local isolation passed.** The overwrite/event consequence is a source-derived risk, not a demonstrated cross-user incident. [Ordering][precommit], [queue dispatch][queue].

The public v1.66.4 source has the same awaited COMMIT/rethrow pattern in the inspected functions ([wrapper][old-transaction], [COMMIT][old-commit]); this narrow comparison does not establish binary, backend, migration, or full-protocol parity.

### Lock and security conditions

- Both sides must use the identical transaction-scoped key `hashtextextended(user_uuid::text, 52017003)`: shared in the deferred fence, exclusive while publishing the deletion request. Stage 2 namespace `52017002` is separate.
- If finalization acquires shared first, its commit precedes the exclusive request fence. If the request acquires exclusive first, the finalizer waits, then must observe pending state and reject. This orders **metadata publication**, not provider-byte creation or whole upload streams. [Advisory locks][pg-locks].
- Retain READ COMMITTED and a VOLATILE trigger function; acquire the lock in one statement and perform fresh pending/Auth reads afterward. Do not precompute state or put the security decision in trigger `WHEN`, which is evaluated before deferral. Reject unsupported isolation modes. [Snapshots][pg-volatility], [trigger timing][pg-trigger].
- Derive identity from OLD/NEW stored owner and canonical UUID path, not `auth.uid()` of an elevated finalizer. Sort multiple identities deterministically. Audit unattributable/admin-created paths and moves out of the guarded bucket; this upload analysis is not proof for every move/copy/rename endpoint.
- Deferred execution acquires advisory locks after object locks. Keep the exclusive request transaction short and free of Storage row locks/API work; otherwise lock-order inversion can deadlock. The inspected request function only publishes/locks the job, so this is a future-change risk, not a demonstrated current deadlock.
- `SET CONSTRAINTS ... IMMEDIATE` can force an earlier failure and re-break a probe, but cannot waive the constraint. Trigger disabling or privileged bypass of the entire mechanism remains outside the guarantee. [Constraint settings][pg-constraints].

## Protocol matrix

All rows describe v1.77.5 source, not observed hosted configuration. "Fence" means the scoped metadata commit fence, not physical erasure.

| Protocol | Authentication / admission | Subsequent authorization | State / owner_id | Finalization / fence | Expiry / in-flight limit | Supported abort / inventory | Cleanup evidence / limit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REST standard | Bearer JWT; caller-RLS `canUpload` before streaming | No equivalent caller-RLS check at final metadata commit | Final object uses request JWT `sub`; no client-visible S3 multipart row | Bytes first; shared elevated `completeUpload`; deferred fence at actual commit | JWT expiry does not establish cancellation of an admitted stream | Cancel request; object remove only for published objects; no REST multipart-abort API | Backend abort signal plus attempted-version cleanup; not atomic byte/DB rollback. [Uploader][uploader], [backend][backend-upload] |
| Signed REST | Caller-RLS at URL issuance; upload token at redemption | Signature/scope/path/expiry checked; redemption uploads as superuser, not original caller RLS | Embedded signing owner's identity, possibly absent | Same elevated finalizer and commit fence | Hosted docs: 2 hours; admitted-stream bound still required | No per-token revoke/abort route found; cancel request, remove published object | Changing user RLS/Auth does not itself revoke capability; failure cleanup remains separate. [Redemption][signed-redemption], [docs][signed-doc] |
| TUS, JWT or signed | JWT route or signed route with `x-signature` | JWT mutating requests, including DELETE, run `canUpload`; signed requests reverify token; JWT HEAD skips upload-permission test | Provider `.info`/parts, not Storage S3 multipart SQL tables; final request owner or signed payload owner | Provider finishes before `onUploadFinish` calls shared finalizer | Hosted URL up to 24 hours; source S3-store default is configurable 1 hour, not hosted attestation | DELETE known unfinished URL; valid auth and preflight required; completed termination disabled; no server "list my TUS uploads" found | Final rejection sends version cleanup; URL expiry is not evidence all parts/.info/bytes were removed. [Hooks][tus-hooks], [docs][tus-doc], [termination][tus-delete] |
| S3 single PutObject | SigV4; user session JWT or server credentials | Caller upload preflight; generated unrestricted keys bypass RLS | Request JWT/credential subject; a new service-role object can have no owner | Shared uploader, bytes before elevated metadata commit | Signature/token expiry does not bound admitted body/finalization | Cancel request; DeleteObject for published object | Same failed-finalization cleanup; generated keys must not bypass the deployment's writer controls. [Uploader][uploader], [auth][s3-auth] |
| S3 multipart | SigV4 CreateMultipartUpload, UploadPart, CompleteMultipartUpload, AbortMultipartUpload | Each operation uses upload preflight, including abort; final write elevated | Parent = initiator; part = part caller; final object = completing caller, not necessarily parent owner | Provider Complete + HEAD, then shared finalizer, then SQL parent deletion | Docs: auto-abort after 24 hours; no proof of SQL residual/finished-byte GC deadline | AbortMultipartUpload; ListMultipartUploads/ListParts under their own table RLS, not an implicit owner filter | Rejected final write leaves parent/parts; completed bytes need separate cleanup; abort can clear rows without deleting finished object. [Completion][complete], [abort][abort], [schema][multipart-schema] |

Additional matrix evidence: [signed issuance][sign-issuance], [TUS routes][tus-routes], [TUS finish][tus-finish], [TUS configuration][config], [pinned TUS store][tus-store], [official S3 compatibility][compatibility].
REST HTTP `multipart/form-data`, S3 API multipart, and TUS's provider-internal multipart are different inventories. Absence from the S3 SQL tables does not rule out REST/TUS provider bytes.
JWT signature validation alone is not a fresh `auth.users` existence check; retain the separate missing-Auth fence. Ownership itself grants no permissions. [JWT plugin][jwt], [ownership documentation][ownership].

## S3 multipart lifecycle and physical blind spot

1. **Create:** preflight, provider create, then superuser INSERT into `s3_multipart_uploads` with initiator owner, bucket/key/version/signature. A provider-create/SQL-insert failure gap exists; the method has no compensating catch around that gap. [Create][multipart].
2. **Part:** preflight, provider upload, then superuser INSERT into `s3_multipart_uploads_parts` with that caller's owner. A part-row failure does not itself abort the provider upload. The catch adjusts in-progress accounting. [UploadPart][part].
3. **Complete:** provider completion and HEAD precede object metadata commit. Only successful `completeUpload()` is followed by `deleteMultipartUpload()`. A trigger rejection therefore leaves parent/part rows. [Complete][complete].
4. **Compensation:** `ObjectAdminDelete` deletes the attempted version and `.info`, but no multipart SQL rows. Queue-enabled delivery is asynchronous; queue-disabled handling is synchronous. Provider failures, disabled events, and queue failure can defeat or delay compensation. No finite cleanup SLA is proved. [Catch][uploader], [delete handler][delete-event], [queue][queue].
5. **Abort:** preflight, provider abort, then parent delete. Provider `NoSuchUpload` is explicitly tolerated, including an already-completed upload; parent deletion cascades to parts. Neither table has an Auth FK. [Abort][abort], [schema][multipart-schema].
6. **After completion:** abort does not delete the finished provider object. Incomplete-upload lifecycle rules do not delete it either. Normal object removal depends on metadata, so it cannot reliably target a rejected version with no row. If compensation fails, hosted operator/Supabase intervention is needed. [Object deletion][object-delete], [AWS lifecycle][aws-expiry].
7. **In-flight abort race:** AWS documents that concurrent parts may still succeed and may require repeated abort/verification. Supabase's public handler issues one abort and deletes its SQL inventory; its empty list is not an independent provider-parts inspection. [AWS abort][aws-abort], [abort handler][abort].

**Do not equate zero metadata rows, an empty multipart list, an abort success, or elapsed TTL with zero physical bytes.** Preserve an unresolved cleanup condition until provider evidence resolves the blind spot; never SQL-delete residual rows to make verification pass.

## Supported operator abort and owned listing

- Endpoint: SigV4-signed `DELETE /storage/v1/s3/{bucket}/{key}?uploadId=...`, not a plain Bearer DELETE. S3 protocol/tenant feature must be enabled. [Route][abort-route], [feature/auth registration][s3-routes].
- Official user-JWT mode: project ref as access key, **legacy anon key** as signing secret, user JWT as session token. User abort remains subject to the upload preflight; changing to deferred timing does not remove an RLS denial. [Official auth][s3-auth], [abort][abort].
- **No new S3 keys inherently required:** v1.77.5 source uses the same signature branch for an existing service-role JWT session token, verifies that JWT, and propagates its claims without an authenticated-only role restriction. This service-role combination is source-derived, not an explicit hosted-doc promise. `sb_publishable_*` is not supported as the signing secret; `sb_secret_*` is not a JWT session token. Do not assume an env variable's name establishes its credential type. [Signature/JWT handling][signature], [DB claims][db-context].
- This app has no production AWS SDK integration for this task. Use an established operator client only with separately approved existing credentials and proved ownership. No handwritten signing adapter, new production dependency, direct backing-provider access, or new keys are authorized by this note.
- `ListMultipartUploads` is supported and paginated, queries SQL under caller RLS, and returns key/upload ID/time, **not owner**. There is no owner query parameter. Stock migrations grant SELECT with RLS enabled but no own-upload policy; user-owned inventory needs an appropriate policy, e.g. `owner_id = auth.uid()::text`. Generated/server credentials can see more than one user's uploads. [List implementation][list-handler], [SQL][list-db], [RLS grants][multipart-schema].
- Prefix filtering alone misses owner-attributed legacy keys and does not prove ownership of every returned key. Read-only SQL inventory can include owner OR canonical path and parts via matching parents. SQL inventory is not authorization to mutate the managed rows or to abort unrelated uploads.

## Alternatives A-F

The requested A-F designs are compared below. No option alone proves instantaneous physical erasure; all-protocol coverage requires closing every direct/elevated writer and addressing admitted work.

| Alternative | REST | Signed uploads | TUS | S3 single / multipart | Already in flight | Hosted feasibility / complexity | Assessment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. Current trigger: immediate vs deferred | Scoped metadata writes fenced | Elevated final metadata also fenced | Final metadata fenced; immediate trigger can obstruct termination probes | Put/Complete metadata fenced; immediate trigger blocked abort, deferred probe rolls back | Deferred shared/exclusive ordering rejects late commits, not byte ingress or pre-commit side effects | Custom triggers officially permitted; medium/high lifecycle coupling and version testing | Retain deferred variant: local 14/14 supports it; actual hosted cleanup/version behavior still needs confirmation |
| B. Provider hooks/events | Creation notifications, not vetoes | Same shared notification path | Finish notification is not cancellation | Put/Complete notifications do not fence multipart Create/Part or publication | Async delivery cannot prevent an already-running upload or its commit | Consuming events is straightforward; a provider-enforced veto would need a separately supported mechanism | No documented synchronous pre-commit tenant cancellation hook found in reviewed docs; current async webhooks are not a fence [webhook semantics][webhook] |
| C. Server-mediated gateway | Works only when every write must traverse it | Gateway must control issuance and redemption/bypasses | Must mediate create/PATCH/finish, not merely issue a URL | Must mediate Put/Create/Part/Complete and close direct JWT/key paths | Can track/cancel its own requests; old capabilities and already-admitted provider work still need drain/cleanup | High: proxy cost, direct endpoint enforcement, credential/issuer controls | Conditional all-protocol design, not a small application-only change |
| D. Remove client upload capabilities | Removing upload RLS access blocks new user admission | Stop minting; existing signed URLs retain capability until expiry/fence | Block new JWT mutations and issuance; signed URLs need separate handling | User-JWT writes can be denied; server/generated keys are separate writers | Does not recall admitted bodies or completed provider writes | Medium/high: breaks direct-client workflows; all policies, issuers and elevated paths need review | Admission reduction, not an all-protocol finalization or erasure guarantee |
| E. Short capability + drain | Bound actual JWT admission windows and rescan | Bound issuance/acceptance; do not assume hosted signed TTL is freely configurable | Account for both upload-URL and authorization lifetimes | Bound JWT/presigned access and multipart lifecycle; unrestricted keys do not expire with user Auth | Finite drain is valid only with attested request, finalizer and cleanup bounds | Medium operational complexity; hosted settings/lifetimes require confirmation | Supporting measure; 25 hours is conditional, never a SQL-residual or physical-erasure TTL |
| F. Protocol restrictions: REST / signed / TUS / S3 | Retained REST still needs a commit fence | Disabling issuance alone does not revoke old signed URLs | Must enforce endpoint restriction, not remove client UI/library | S3 feature gating can close that surface; zero generated keys alone does not block JWT S3 | Restricting new requests does not prove cancellation/cleanup of accepted work | Low to high depending on available hosted controls; do not assume independent switches for every path | Reduced attack surface only; verify provider controls and retain coverage for every allowed protocol |

## Expiry, hosted permission, and rollout gates

Official docs specify signed upload URLs lasting 2 hours, TUS upload URLs up to 24 hours, and automatic S3 multipart abort after 24 hours. The v1.77.5 public code inspected does not establish a scheduled SQL multipart-row GC bound; provider-completed objects are outside incomplete-upload expiry. TUS delegates to pinned `@tus/s3-store` 2.0.3 / `@tus/server` 2.4.2; its cleanup also depends on provider lifecycle/explicit cleanup scheduling. [Docs][signed-doc], [TUS][tus-doc], [S3][s3-doc], [dependencies][dependencies], [store expiry][tus-expiry].
A 25-hour capability drain can only be a conditional deployment policy. Expiry does not retroactively cancel accepted requests, guarantee SQL cleanup, or prove byte erasure. No automatic completion or tombstone purge follows just from the deadline.

**Hosted custom triggers are officially permitted**, including on `storage.objects` and both multipart tables, by Supabase's hosted permissions announcement. Custom functions belong in an application-owned schema. General schema docs still discourage managed-schema alterations and require data mutations through Storage APIs. Permission to create the trigger does **not** promise this fence's lifecycle compatibility, transactional side effects, or bounded physical cleanup. [Hosted permission][hosted], [schema guidance][schema-doc].

Before rollout, require:
- Exact deployed Storage image/digest, migrations, backend, queue settings, PostgreSQL version/isolation and feature settings remain unknown; neither upstream v1.77.5 source nor local/CI v1.66.4 establishes the deployed hosted version or behavior.
- Under a separately approved version-matched disposable/provider test plan, repeat the reported passing cases and cover new object/overwrite, pending/missing Auth, user/elevated/signed requests, old capabilities and abort/termination races. Assert HTTP outcome, real COMMIT failure, retained prior object, both versions' bytes and multipart residuals; do not infer unreported protocol coverage. This document authorizes no destructive production tests.
- The two deterministic SQL lock orderings now have local/CI evidence with the distinct timing limits above. Hosted transaction/COMMIT-failure compensation, in-flight boundary races, savepoint behavior and timeout/deadlock/queue/provider failures remain open. Include pre-commit webhook and old-version deletion behavior explicitly.
- Provider confirmation of maximum admitted-stream duration, finalization delay, retries/queue cleanup deadline, multipart SQL cleanup and provider-parts cleanup; verify how completed orphan versions are detected and removed.
- Approved credential inventory and no uncontrolled elevated writers. Keep residual/operator state fail-closed after retries; an operator abort is not authority to mark physical cleanup verified.
- Separate statements for active provider bytes, CDN caches, backups and retention. Do not describe metadata absence as guaranteed erasure of all retained copies.
- Provider confirmation of compatibility with managed migrations and this specific deferred trigger, not merely general permission to create custom triggers. Elevated writers, unattributable identities and cross-bucket moves remain unverified.
- Historical/alternate access-JWT acceptance plus clock skew/leeway must fit inside 30-day completed-tombstone retention. The supplied current issuance setting is **3600 seconds** (719 hours below 30 days before skew), not proof of historical token maxima. Pending/terminal jobs are not automatically purged.
- Explicit operator ownership and approved resume access for **every** job after its durable **25-hour** drain, plus terminal and `PROVIDER_RESIDUAL` escalation. No automatic runner exists. Read-only listing and offline shape-only runtime preflight do not supply that operational readiness.
- Actual Vercel runtime/`maxDuration`, production environment and merge/deployment separation remain unverified. Migration must precede matching app deployment under separate authorization; rollback must retain fence/jobs/tombstones and use only a compatible deletion-aware build. Never restore the legacy flow to bypass these gates.

**Production rollout remains NO-GO.** Green CI and Preview are review evidence, not a provider
attestation or permission to merge/deploy. See the operator and rollout sections in
[account-deletion.md](account-deletion.md) for the current workflow and conditional runbook.

## Primary source links

Sources are linked beside each claim. Storage URLs are version-tagged; upstream TUS URLs are pinned to the published dependencies' git commits. Live documentation is not a versioned runtime contract.

[tag]: https://github.com/supabase/storage/tree/v1.77.5
[commit]: https://github.com/supabase/storage/tree/2f89775ead04da4b681da3b15d39f129366719ac
[preflight]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/uploader.ts#L72-L109
[probe]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/database/pg.ts#L286-L298
[transaction]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/database/pg.ts#L186-L258
[commit-code]: https://github.com/supabase/storage/blob/v1.77.5/src/internal/database/pg-connection.ts#L558-L575
[uploader]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/uploader.ts#L118-L300
[precommit]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/uploader.ts#L237-L288
[queue]: https://github.com/supabase/storage/blob/v1.77.5/src/internal/queue/event.ts#L163-L311
[webhook]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/events/base-event.ts#L30-L68
[backend-upload]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/backend/s3/adapter.ts#L161-L285
[sign-issuance]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/object.ts#L934-L962
[signed-redemption]: https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/object/uploadSignedObject.ts#L82-L100
[tus-routes]: https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/tus/index.ts#L61-L227
[tus-hooks]: https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/tus/lifecycle.ts#L61-L175
[tus-finish]: https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/tus/lifecycle.ts#L306-L358
[config]: https://github.com/supabase/storage/blob/v1.77.5/src/config.ts#L431-L444
[signature]: https://github.com/supabase/storage/blob/v1.77.5/src/http/plugins/signature-v4.ts#L172-L281
[db-context]: https://github.com/supabase/storage/blob/v1.77.5/src/http/plugins/db.ts#L54-L74
[jwt]: https://github.com/supabase/storage/blob/v1.77.5/src/http/plugins/jwt.ts#L36-L68
[multipart]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/protocols/s3/s3-handler.ts#L462-L527
[part]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/protocols/s3/s3-handler.ts#L631-L751
[complete]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/protocols/s3/s3-handler.ts#L536-L606
[abort]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/protocols/s3/s3-handler.ts#L807-L856
[delete-event]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/events/objects/object-admin-delete.ts#L31-L85
[object-delete]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/object.ts#L142-L168
[multipart-schema]: https://github.com/supabase/storage/blob/v1.77.5/migrations/tenant/0021-s3-multipart-uploads.sql#L1-L84
[abort-route]: https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/s3/commands/abort-multipart-upload.ts#L50-L60
[s3-routes]: https://github.com/supabase/storage/blob/v1.77.5/src/http/routes/s3/index.ts#L138-L200
[list-handler]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/protocols/s3/s3-handler.ts#L335-L452
[list-db]: https://github.com/supabase/storage/blob/v1.77.5/src/storage/database/pg.ts#L954-L1038
[dependencies]: https://github.com/supabase/storage/blob/v1.77.5/package.json#L86-L87
[tus-store]: https://github.com/tus/tus-node-server/blob/57b1be9bcb01c035bdc30aa1658db36197a409cb/packages/s3-store/src/index.ts#L563-L725
[tus-delete]: https://github.com/tus/tus-node-server/blob/affc5ead329422caec9567fb9e9f6bdff47fd611/packages/server/src/handlers/DeleteHandler.ts#L11-L24
[tus-expiry]: https://github.com/tus/tus-node-server/blob/57b1be9bcb01c035bdc30aa1658db36197a409cb/packages/s3-store/README.md#L155-L191
[old-transaction]: https://github.com/supabase/storage/blob/v1.66.4/src/storage/database/pg.ts#L86-L158
[old-commit]: https://github.com/supabase/storage/blob/v1.66.4/src/internal/database/pg-connection.ts#L547-L564
[s3-auth]: https://supabase.com/docs/guides/storage/s3/authentication
[compatibility]: https://supabase.com/docs/guides/storage/s3/compatibility
[signed-doc]: https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
[tus-doc]: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
[s3-doc]: https://supabase.com/docs/guides/storage/uploads/s3-uploads
[ownership]: https://supabase.com/docs/guides/storage/security/ownership
[hosted]: https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025
[schema-doc]: https://supabase.com/docs/guides/storage/schema/design
[aws-abort]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html
[aws-expiry]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html
[pg-trigger]: https://www.postgresql.org/docs/current/sql-createtrigger.html
[pg-constraints]: https://www.postgresql.org/docs/current/sql-set-constraints.html
[pg-locks]: https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
[pg-volatility]: https://www.postgresql.org/docs/current/xfunc-volatility.html
