# Marketplace mutation boundaries: design and red regression baseline

Status: **historical design/test baseline, captured before implementation**.

The implementation and final validation now live in
[marketplace-security.md](marketplace-security.md). Statements below about
current behavior refer to the baseline commit, not the uncommitted remediation.

Date: 2026-09-14. Repository: `YelzhasTem/word-ace-deck`.
Baseline: `main`, `e72a5b6914b9c38606c2e67c196efcd4c069ec05`.
Original design branch: `codex/marketplace-boundary-design`, at the same commit.
Implementation branch: `codex/harden-marketplace-boundaries`.

This work is in the separate checkout
`/Users/baytime/Documents/memora-marketplace-boundaries`. The pre-existing dirty
checkout at `/Users/baytime/Documents/memora` was not changed. No commit, push,
PR, deployment, production query, production migration, or secret change was
performed. Findings below describe the repository and its freshly rebuilt local
Supabase database, not a new verification of production schema drift.

## A. Confirmed writable protected columns

All eight requested fields are directly writable by an authenticated owner on
**both** `decks` and `collections`:

| Field           | Current successful owner action                       | Intended authority                  |
| --------------- | ----------------------------------------------------- | ----------------------------------- |
| `hidden_at`     | Set it or clear a pre-existing moderation timestamp   | Admin-only (C)                      |
| `learner_count` | Assign an arbitrary nonnegative integer               | Trusted copy-event aggregate (D)    |
| `like_count`    | Assign an arbitrary nonnegative integer               | Like rows (D)                       |
| `rating_sum`    | Assign a forged sum satisfying the arithmetic CHECK   | Rating rows (D)                     |
| `rating_count`  | Assign a forged count satisfying the arithmetic CHECK | Rating rows (D)                     |
| `view_count`    | Assign an arbitrary nonnegative integer               | Trusted view events (D)             |
| `copy_count`    | Assign an arbitrary nonnegative integer               | Trusted copy events (D)             |
| `published_at`  | Backdate a public resource to 2001                    | Database publication transition (B) |

This is not just a TypeScript concern. Local catalog inspection shows table-wide
INSERT and UPDATE grants covering all 21 deck columns and all 17 collection
columns. Real authenticated Supabase JS requests successfully write the fields
above. A protected value can also be supplied on INSERT; fixing UPDATE alone is
insufficient.

An additional local probe seeded a hidden resource through fixture-only service
credentials, confirmed anon could not read it, cleared `hidden_at` with the
owner's ordinary JWT, and confirmed anon could then read it. Reproduced for both
resource types. No real user records were used.

### Complete column ownership classification

| Table         | A: owner-editable UPDATE columns                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `decks`       | `name`, `description`, `cover_color`, `target_language`, `definition_language`, `visibility`, `category`, `keywords` |
| `collections` | `name`, `description`, `visibility`, `keywords`                                                                      |

The following remaining fields account for every column on these two tables:

| Fields                                   | Class and intended treatment                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                     | B: generated identity, no generic client INSERT/UPDATE                                                                               |
| `user_id`                                | B: authenticated ownership; existing direct collection INSERT may supply only `auth.uid()` under RLS; never owner-editable afterward |
| `created_at`, `updated_at`               | B: database timestamps, not client-controlled                                                                                        |
| `source_deck_id`, `source_collection_id` | B: immutable copy provenance written only by trusted copy RPCs                                                                       |
| `published_at`                           | B: derived from an authorized visibility change, not arbitrary client time                                                           |
| `hidden_at`                              | C: admin moderation, never changed by owner publishing/editing                                                                       |
| All six counters listed above            | D: server-maintained values; no generic client writes                                                                                |

Supporting tables:

- Likes/saves: `id`, parent ID, `user_id`, `created_at`. The actor may create their
  own parent relation and remove their own relation; identity/timestamp fields
  are system-owned. There is no mutable business value requiring UPDATE.
- Ratings: those same fields plus `rating` and `updated_at`. Only the rating
  value is actor-editable after insertion. Parent/user identity must be immutable.
- Reports: `id`, parent ID, `reporter_id`, `reason`, `status`, `created_at`,
  `reviewed_at`. The actor submits parent/reporter/reason. Status and review time
  are admin-only; identifiers/timestamps are system-owned.

Catalog privileges alone do NOT prove ownership reassignment works: existing RLS
and foreign keys can still reject a `user_id` change. The tests distinguish a
missing column-level boundary from a proven successful row mutation.

## B. Current authorization path

### Schema and policy sources inspected

All 32 committed migrations were applied to an isolated local Supabase stack.
Current catalog inspection covered columns, defaults, CHECK/FK/UNIQUE constraints,
table/column grants, policies, functions, and triggers. Relevant migration owners:

| Migration                                                               | Relevant responsibility                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `20260602045055_e404502d-9cd7-4601-9b36-d08e39142333.sql`               | Roles, `has_role`, timestamp helper                                           |
| `20260602065106_51ec5f1b-fb4c-43bd-b239-d419385dc02d.sql`               | Deck/card tables, owner RLS, broad grants                                     |
| `20260602080904_af1d1603-819b-453a-aff9-d9cfb43a8c60.sql`               | Regrants                                                                      |
| `20260602091759_9d22d37e-2d8b-41ed-bd78-73d077a5f0ef.sql`               | Collections/links, owner RLS, broad grants                                    |
| `20260609120000_public_deck_marketplace.sql`                            | Deck marketplace fields and interaction/report policies                       |
| `20260609133000_public_collection_marketplace.sql`                      | Equivalent collection marketplace schema                                      |
| `20260610120000_grant_has_role_execute_for_policies.sql`                | Role helper execution                                                         |
| `20260610123000_remove_has_role_from_update_policies.sql`               | Current generic admin UPDATE policies                                         |
| `20260703130000_add_deck_cover_color.sql`                               | Owner presentation field                                                      |
| `20260713133000_add_deck_target_language.sql`                           | Owner language field                                                          |
| `20260713143000_add_deck_definition_language.sql`                       | Owner language field and its historical backfill                              |
| `20260729120000_remove_profile_email_and_harden_privacy.sql`            | Public creator visibility dependencies                                        |
| `20260729180000_trusted_study_write_api.sql` and later study migrations | Public/hidden deck access dependencies                                        |
| `20260731010000_harden_database_integrity.sql`                          | Counter/publication CHECKs, ownership FKs, keywords helper                    |
| `20260802010000_atomic_deck_creation.sql`                               | Trusted creation/copy RPCs and private idempotency/default-collection helpers |

`src/integrations/supabase/types.ts` matches the table field inventory. There are
no public views in the rebuilt schema. The only four non-FK triggers on the ten
audited tables update `updated_at` on decks, collections, deck ratings, and
collection ratings. **There are no aggregate-maintenance triggers.**

### Roles, grants and RLS

- `requireSupabaseAuth` verifies the Authorization token with Supabase claims and
  constructs a publishable-key client carrying that user's JWT. Marketplace
  server functions are not using a service-role client.
- Generic deck/collection UPDATE is allowed when the row belongs to `auth.uid()`
  OR the actor has an admin role. Policies named `Users update own decks` and
  `Users update own collections` do not restrict individual columns.
- Owners can read their own hidden rows. Public SELECT permits only `public`
  and `hidden_at IS NULL`; authenticated non-owners additionally see unlisted
  resources. Thus clearing `hidden_at` really re-exposes content.
- Likes/saves INSERT checks only `user_id = auth.uid()`; DELETE checks ownership.
  Ratings INSERT/UPDATE similarly checks actor ownership but not immutable
  parent identity. Parent visibility is not checked on these INSERT policies.
- Ratings have no authenticated DELETE grant/policy. Rating cleanup tests use a
  trusted fixture client; this design does not add a user-facing delete feature.
- Reports INSERT checks only `reporter_id = auth.uid()`. A user can submit
  `status = 'dismissed'` with `reviewed_at`, bypassing the pending queue.
  Report SELECT/UPDATE uses `has_role(auth.uid(), 'admin')`.
- Broad legacy REFERENCES/TRIGGER/TRUNCATE grants remain on these tables for
  anon/authenticated. No arbitrary-SQL endpoint exposing TRUNCATE was found;
  do not confuse a catalog excess with a confirmed public REST truncate exploit.
- Service role retains trusted server/fixture access. Normal app users cannot
  assign themselves a role through `user_roles`.

### Additional reproduced moderation failure

With an actual authenticated admin actor whose DB admin role was independently
verified, the existing generic `UPDATE hidden_at` on another user's public deck
or collection returned `42501` with an RLS violation and did not persist. The
new hidden row no longer passes that non-owner's SELECT visibility condition.
Changing the report's status independently did succeed. The existing deck
wrapper uses these two separate requests and has no transaction tying them
together. Its hide branch stops on the first error; it does not successfully
complete a hide in this reproduced case.

A non-admin updating someone else's resource affects zero rows. However an
owner can mutate their own moderation field, and a non-admin report update may
silently affect zero rows while the wrapper still returns `{ ok: true }`.

## C. Complete affected write inventory

References below are source locations at the baseline commit, not proposed code.
All searches included `src`, every migration, server-function imports, table
inserts, updates, upserts, RPC definitions, and generated database types.

| Location                                                | Function/path                                      | Actual write and authority                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/community.functions.ts:430`, write at 448      | `getPublicDeckDetails`                             | User JWT writes `view_count = previously_read + 1`; ignores update result                                                    |
| `src/lib/community.functions.ts:462`, write at 480      | `updateDeckPublishing`                             | User JWT writes `published_at` together with visibility/category/keywords                                                    |
| `src/lib/community.functions.ts:491`, write at 517      | `toggleDeckLike`                                   | User inserts/deletes own like, recounts rows, separately writes parent `like_count`; ignores parent update result            |
| `src/lib/community.functions.ts:522`                    | `toggleDeckSave`                                   | Own save INSERT/DELETE only; no counter change                                                                               |
| `src/lib/community.functions.ts:545`, write at 569      | `rateDeck`                                         | Own rating upsert, reads all rating values, separately writes parent `rating_sum/rating_count`; ignores parent update result |
| `src/lib/community.functions.ts:573`, write at 601      | `rateCollection`                                   | Same pattern for collections; no frontend caller found                                                                       |
| `src/lib/community.functions.ts:606`, 617               | `reportDeck`, `reportCollection`                   | Own parent/reporter/reason INSERT; shared reason validation, no app-supplied moderation fields                               |
| `src/lib/community.functions.ts:630`, 645               | `duplicatePublicDeck`, `duplicatePublicCollection` | Calls the two trusted atomic copy RPCs below                                                                                 |
| `src/lib/community.functions.ts:748`, writes at 763/769 | `reviewDeckReport`                                 | Generic user-JWT UPDATE of `decks.hidden_at`, then report `status/reviewed_at`; client supplies independent deck/report IDs  |
| `src/lib/collections.functions.ts:113`, write at 130    | `updateCollectionPublishingRecord`                 | User JWT supplies `published_at` with visibility/keywords                                                                    |
| `src/lib/collections.functions.ts:30`, 60               | `createCollectionRecord`, `updateCollectionRecord` | Existing ordinary INSERT/UPDATE uses owner fields, not counters                                                              |
| `src/lib/decks.functions.ts:47`, 129                    | `createDeckWithCardsRecord`, `updateDeckRecord`    | Creation calls trusted RPC; ordinary edit uses name/description/cover color only                                             |
| `20260802010000_atomic_deck_creation.sql:227`           | `private.get_or_create_default_collection`         | Inserts owner/name/description; defaults initialize private/system fields                                                    |
| Same migration, 395                                     | `create_deck_with_cards`                           | Trusted INSERT initializes private visibility and NULL publication time; counters use defaults                               |
| Same migration, 528/555                                 | `duplicate_public_deck_atomic`                     | Trusted INSERT of copy/provenance; source `copy_count += 1`, `learner_count += 1`                                            |
| Same migration, 682/697/728/734                         | `duplicate_public_collection_atomic`               | Trusted collection/deck/provenance INSERTs; increments both counters on collection and each copied source deck               |
| Both marketplace schema migrations                      | Column initialization                              | Counter defaults 0; nullable `hidden_at`/`published_at`; no aggregate backfill or maintenance                                |

No other application counter or `hidden_at` writer was found. Collection like
and save tables are read by marketplace metadata code, but no frontend mutation
flow was found for them; they remain directly accessible via Supabase under
their policies. No collection view-tracking or moderation wrapper was found.

Entry points inspected: `community.$deckId.tsx`, `community.tsx`,
`community-admin.tsx`, `study.$deckId.tsx`, `publish.tsx`, `collections.ts`,
`decks.ts`, and dashboard creation. `account.functions.ts` deletes interactions
and resources during cleanup but does not maintain these counters; it must
remain unchanged in this work. FK-triggered deletion is also an aggregate
maintenance input, not an alternate counter writer.

### Counter semantics and observed results

- `like_count`: intended COUNT of like rows. A non-owner's like INSERT succeeds,
  but the stored count remains 0; unlike of a seeded consistent count leaves 1.
- Ratings: a first rating of 2 leaves sum/count at 0/0. Updating a seeded 2/1
  rating to 5 leaves 2/1. Upserts are unique per actor/resource, but parent values
  are not authoritative. Non-owner parent UPDATE affects zero rows under RLS.
- Views: reproducing the existing authenticated read/update sequence affects
  zero rows for a visitor; the stored value remains 0. Owners can write it, and
  parallel read-modify-write operations can lose increments.
- `copy_count` and `learner_count`: currently increment together on successful
  copies, including each deck inside a copied collection. They do not count
  saves, study sessions, or distinct users. Same-key replay correctly increments
  only once. Do not silently redefine learners as saves or unique learners.
- Concurrent different-key copies are problematic: both RPCs take `FOR SHARE`
  on the source before later updating its counters. A copy-only rerun returned
  `P0001` for both resource types and increased PostgreSQL's `deadlocks` counter
  from 3 to 5. These are failed transactions, not evidence that a successfully
  committed arithmetic increment was lost. Collection copies sharing source
  decks also need consistent lock ordering.

## D. Regression tests added and executed

### New SQL contract tests

`supabase/tests/marketplace_boundaries.sql`: 80 assertions in a transaction that
rolls back. They cover protected INSERT/UPDATE privileges, copy provenance,
ownership UPDATE privilege, owner-editable columns, moderation fields on
reports, and RLS retained on all ten tables.

Result on unchanged schema: **22 passed, 58 failed (intentionally red)**.
Permission failures describe the proposed least-privilege contract; they do not
all imply an independently exploitable row-level operation.

### New local Supabase JS/PostgREST/RPC tests

`tests/marketplace-boundaries.test.mjs`: refuses non-loopback Supabase URLs before
creating a client. Four synthetic actors use independent authenticated sessions;
service credentials are used only for fixture setup, trusted cleanup, and
authoritative assertions. Temporary users are deleted in the `after` hook even
when assertions fail. No production credentials or content are required.

61 tests cover both resource types:

- All eight requested protected fields, mixed editable/protected writes, forged
  INSERT, normal owner edits, cross-user isolation, and hidden public reads.
- Report moderation-field injection, non-owner like/unlike, parallel likes,
  initial rating, changing/repeating an upsert, parallel ratings, trusted rating
  cleanup, and immutable rating identity.
- Existing save semantics, idempotent copy replay, concurrent distinct copies,
  and nested collection/deck copy counters.
- Proposed trusted moderation/view contracts, including admin hide, non-admin
  rejection, concurrent distinct viewers, same-viewer replay, anon denial and
  hidden-resource denial.

Final full run: **9 passed, 52 failed**. Of those failures, **42 reproduce
existing write/counter/concurrency problems** and **10 are explicitly labeled
`[proposed RPC]` contracts**. Missing `moderate_marketplace_report` and
`record_marketplace_view` return `PGRST202`, not a fabricated successful security
denial. The missing-RPC tests do not claim those nonexistent APIs are vulnerable.

Concurrent copies were separately rerun: 0/2 passed, two new database deadlocks.
Concurrency failures are schedule-sensitive; an earlier single-round collection
copy passed. The test now exercises up to three two-actor rounds.

### Existing checks retained

| Check                                              | Result                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Fresh local Supabase startup with CLI 2.110.0      | All 32 existing migrations applied from zero                                         |
| `supabase db lint --local --level warning`         | Passed, no schema errors                                                             |
| `supabase test db`                                 | Existing 150 assertions passed; new 58 failures make full 230-assertion run red      |
| `npm run check:database-integrity`                 | Passed, including 5 report tests, database/profile/study/AI static checks, typecheck |
| `npm run check:atomic-deck-creation`               | Passed, including 3 unit tests, atomic static check and typecheck                    |
| `npm run test:security:ai:unit`                    | 13/13 passed                                                                         |
| `scripts/verify-atomic-deck-creation.mjs`          | Passed against local Supabase                                                        |
| `scripts/verify-collection-report-validation.mjs`  | Passed against local Supabase                                                        |
| `scripts/run-profile-email-privacy-fixture.mjs`    | Passed against local Supabase                                                        |
| `scripts/run-study-data-integrity-fixture.mjs`     | Passed against local Supabase                                                        |
| `scripts/verify-ai-security-quotas.mjs`            | Passed; test configuration changes only in the disposable local database             |
| `npx eslint tests/marketplace-boundaries.test.mjs` | Passed after formatting this new test file only                                      |

No production build or repository-wide lint rerun was needed for this test/doc
only phase. No GitHub Actions were started. The new SQL file is automatically
discovered by the existing DB workflow and intentionally makes it red until the
fix. The new JS fixture is not wired into CI yet; wiring it is part of the future
fix, not an attempt to pretend this design branch is ready to merge.

After the fixtures and probes, direct local count checks confirmed zero Auth
users, profiles/private profiles, decks/cards, collections/links, all eight
interaction/report table row counts, creation requests and default-collection
mappings. The isolated test stack is stopped after verification. The remote
`main` SHA was rechecked and still matched the baseline; it was not updated.

Reproduction commands, with **only local** Supabase environment variables loaded:

```sh
npx --yes supabase@2.110.0 test db
node --test --test-reporter=tap tests/marketplace-boundaries.test.mjs
node --test --test-name-pattern='distinct concurrent atomic copies' tests/marketplace-boundaries.test.mjs
```

The JS runner requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` from the isolated local stack. Do not source a real
project's `.env`; do not log `supabase status` credential output.

## E. Proposed SQL/RPC/privilege design

### 1. Use column privileges, with RLS as a separate row boundary

Revoke table-wide INSERT/UPDATE on decks/collections from PUBLIC, anon and
authenticated, and remove any inherited explicit column grants before installing
the reviewed allowlists. Revoking `UPDATE(hidden_at)` alone does nothing while
the role retains table-level UPDATE. Cover INSERT as well as UPDATE.

Grant authenticated UPDATE only on the A columns above; grant INSERT only on
the permitted new-resource business fields and `user_id` with the existing
self-ownership WITH CHECK. Preserve legitimate SELECT/DELETE and owner RLS.
Make USING and WITH CHECK explicitly enforce `auth.uid() = user_id` on ordinary
owner updates. Remove the two now-unnecessary generic admin UPDATE policies:
admin moderation will use a narrow definer RPC instead.

Reports get column-scoped INSERT of parent ID, reporter ID and reason. Remove
generic authenticated UPDATE of report moderation fields and the obsolete
generic admin UPDATE policies; retain admin-only SELECT for the queue.
Remove unnecessary REFERENCES/TRIGGER/TRUNCATE grants on the ten scoped tables.
Do not weaken RLS or introduce a service-role marketplace client.

### 2. Trusted interaction triggers

Private SECURITY DEFINER trigger functions, fixed `search_path = pg_catalog`,
fully qualified object names, and no PUBLIC/anon/authenticated EXECUTE:

- Like INSERT/DELETE atomically changes parent count by +1/-1.
- Rating INSERT changes sum and count together; UPDATE changes sum by
  `NEW.rating - OLD.rating`, with no count change; DELETE reverses both.
- One parent UPDATE applies the whole delta and acquires the row lock. Do not
  read a counter into application memory or recount then overwrite under MVCC.
- Same-value upserts are no-ops for the aggregate. UNIQUE(parent,user) prevents
  duplicate actor ratings/likes. Transactions roll back child and aggregate
  changes together on error.
- Parent deletion/FK cascade and trusted user cleanup must work. A parent
  already deleted in the same transaction is a harmless zero-row aggregate
  UPDATE, not an error. Existing parent CHECK constraints remain enabled.

**Upsert compatibility:** current PostgREST upserts send parent ID, user ID and
rating, even on conflict. Granting only `UPDATE(rating)` would break them. Keep
the necessary syntactic UPDATE grants for those three fields and add a strict
BEFORE UPDATE immutable-identity check; changing parent/user is rejected, but
setting the same keys during upsert succeeds. No rating DELETE privilege is
added for clients. Restrict inserts/updates to accessible public/unlisted,
non-hidden parents; preserve deletion of an actor's own like/save even after
the parent becomes hidden. This validates the events feeding trusted counters.

Triggers are preferred over new like/rating RPCs because existing user-scoped
inserts/upserts remain compatible and **all** write paths, including cascades and
direct PostgREST, participate in the same atomic maintenance.

### 3. Narrow admin moderation RPC

Proposed contract (not implemented):

```text
moderate_marketplace_report(p_resource_type, p_report_id, p_action)
resource_type: deck | collection
action: hide | dismiss
result: resource type, resource ID, report ID, resulting status/hidden timestamp
```

Require non-null `auth.uid()` and an actual admin role read from the database.
Derive the resource from the report; never trust an independent target deck ID.
Use static fully qualified SQL branches, fixed search_path, no arbitrary SQL or
client-supplied role. Revoke EXECUTE from PUBLIC/anon; grant only authenticated,
then explicitly check admin inside the function. Return `42501` on denial and
safe fixed error codes for absent/invalid reports.

Lock and update the report and resource in one transaction. Replaying the same
decision returns the current result without refreshing timestamps. Do not let
a dismiss operation implicitly unhide an already moderated resource. No new
unhide capability is included; it would require a separately reviewed admin
action. Existing `reviewDeckReport` keeps its frontend contract but delegates
to this RPC. Use the existing HTTP error helper and a small fixed marketplace
error map; never return raw SQL/constraint text.

This resolves the owner bypass, the admin RLS visibility failure and the
independent report/resource updates without granting admins generic table-wide
system-field privileges through the shared authenticated role.

### 4. Trusted view RPC, with an explicit product decision

Proposed contract: `record_marketplace_view(p_resource_type, p_resource_id)`.
No caller-supplied user ID, delta, counter, timestamp or replay bucket. Verify
the actor and visible public/unlisted, non-hidden resource in SQL. Revoke anon
execution. Return the authoritative count, not the pre-increment snapshot.

**Recommended, but not yet approved:** count at most one view per authenticated
actor/resource/UTC day. A private receipt table with user FK, either deck FK or
collection FK (exactly one), server-derived day and partial UNIQUE indexes
claims the event with `INSERT ... ON CONFLICT DO NOTHING`. Increment only for
the newly inserted receipt, in the same transaction. Receipt FKs cascade so no
new account-cleanup code is required; no public read/write grants. Keep receipts
through the current and previous UTC day; a documented bounded maintenance task
can remove older receipts without enabling same-day replay. There is currently
no new scheduler in this design/test branch.

The existing deck details server function would invoke this RPC; no collection
view UI is being invented. The generic collection RPC branch is protected/tested
for future callers. This measures bounded authenticated events, not proof that
a human actually viewed content. Multi-account abuse is a separate concern.

The same-viewer test is explicitly a proposed contract. If product chooses
different view semantics, approve that choice and update that contract before
implementation rather than silently changing the meaning of existing metrics.

### 5. Publication timestamps and existing copy RPCs

Recommended publication trigger: set server time when entering public visibility,
preserve it for edits to an already-public resource, and set NULL when leaving
public visibility. Never modify `hidden_at` on these transitions. This preserves
the existing publication consistency CHECK. Remove explicit `published_at`
writes from both publishing server functions.

Preserving an already-public timestamp is a **behavior decision**: today every
publish call refreshes it and may boost recency ordering. Confirm this before
the implementation phase. Owner-controlled publication remains allowed; owner-
controlled arbitrary dates do not.

Keep the existing atomic creation/copy and private idempotency mechanisms.
Replace source `FOR SHARE` locks with an appropriate write-intent lock such as
`FOR NO KEY UPDATE` before work begins. Collection copies must acquire
source-deck write-intent locks in deterministic ID order before per-deck updates,
while keeping presentation order separate. Recheck visibility under those locks.
Test overlapping collections, direct deck copies and deletion together. Do not
add a second copy trigger that double-counts the existing RPC increments.

Retain current cumulative copy/learner semantics. Deleting a copy must not
silently decrement a historical copy event. A future unique-learner metric is
not part of this security change.

## F. Migration strategy

Proposed new file, **not created**:
`supabase/migrations/20260914010000_harden_marketplace_mutation_boundaries.sql`.
Rebase/date-adjust if another migration precedes implementation. Never edit
already applied migrations.

1. Before any separately authorized rollout, compare production schema/grants
   with this baseline and inspect counter drift read-only. Snapshot existing
   aggregate values and definitions without personal content. Stop on drift.
2. Implement the SQL and compatible server wrappers locally, rebuild from zero,
   turn every approved red regression green, and run all existing checks. Test
   the actual TanStack wrappers in preview, not only the DB sequences used here.
3. Use a coordinated, bounded marketplace-write maintenance window. This is not
   an atomic transaction between Vercel and PostgreSQL. Old wrappers write now-
   protected fields, so revoking first without coordination will break them.
4. In one bounded database transaction, acquire the relevant parent/interaction
   table locks in a documented order, install receipt/RPC/trigger/privilege
   boundaries and reconcile like/rating aggregates from their interaction rows.
   Locks must prevent writes racing the reconciliation. Configure lock timeout;
   fail/rollback rather than wait indefinitely on a busy production table.
5. Preserve existing copy/learner/view totals as a documented legacy baseline:
   there is no trustworthy complete historical event ledger to reconstruct them
   from. Do not pretend potentially forged historical totals become verified
   merely because new writes are protected. Reset/reconciliation requires a
   separate explicit decision.
6. Activate the already-tested compatible backend, verify user/admin/anon flows,
   grants and counter invariants, then lift maintenance. Old direct clients
   must receive denial rather than falling back to untrusted writes.

No part of this rollout was performed. Existing profile privacy, study integrity,
AI protection, atomic creation, account deletion and FK semantics must be kept.

## G. Rollback strategy

- Before the migration commits: transaction rollback restores the previous
  database state on any assertion, lock, or reconciliation failure. Do not
  proceed with partially installed privileges/triggers.
- After commit: keep protected privileges and trusted maintenance in place.
  Gate affected marketplace writes if necessary and forward-fix or roll back to
  a **compatible** application artifact. Do not restore the old counter writers
  by regranting table-wide UPDATE or disabling RLS.
- Do not remove triggers while interactions continue. Recompute like/rating
  aggregates under locks if required. Blind restoration of stale counter
  snapshots would discard legitimate intervening interactions.
- Preserve private receipt integrity until the accepted replay window expires;
  dropping receipts mid-window allows duplicate counting.

## H. Compatibility risks and remaining decisions

1. The full new suite is deliberately red. This branch is not a deployable fix
   and not ready for a green CI/merge claim.
2. Column grants cover every role in a user's SQL role inheritance. Revoke broad
   grants, not just explicit protected-column grants; validate the effective
   privilege catalog after migration. Generated TS types do not encode this ACL.
3. Existing upsert payloads, normal collection creation, atomic creation/copy,
   default collection helpers and trusted cleanup must keep working. Tests must
   not add client rating-delete rights just to make cleanup tests pass.
4. Trigger-maintained counts can reveal old corrupt counters; reconcile before
   activating deltas. Counter ranges and BIGINT arithmetic checks remain in place.
5. Parent counter updates currently also touch parent `updated_at`; do not
   inadvertently change timestamp/UI ordering behavior in this focused fix.
6. Admin operations need a real trusted RPC, not merely a new client-side admin
   check. Existing SELECT policies must not be broadened to reveal hidden data.
7. Decide view deduplication and repeated-publication timestamp semantics. Both
   are identified above as decisions, not undisclosed security requirements.
8. Historical aggregate truth cannot be proved from current counters. Preserve
   and disclose the legacy baseline pending an explicit reconciliation decision.
9. Local tests are not production or browser end-to-end verification. Direct
   owner bypass and non-owner zero-row writes were demonstrated with local
   PostgREST/Supabase JS; wrappers were inspected and their DB sequence probed.
10. Rate limits/Sybil prevention for otherwise valid likes/copies/accounts, removal
    and re-creation of moderated content, and unlisted discovery semantics are
    outside this bounded fix. Preventing direct `hidden_at` reversal is not a
    claim to solve every content-moderation evasion technique.

## I. Exact file scope

### Files added in this design/test phase

1. `supabase/tests/marketplace_boundaries.sql`
2. `tests/marketplace-boundaries.test.mjs`
3. `docs/marketplace-boundary-design.md`

No existing tracked file is changed. No migration file is added in this phase.

### Files expected for the later implementation, subject to approval

| File                                                                            | Proposed change                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260914010000_harden_marketplace_mutation_boundaries.sql` | New transactional ACL/trigger/RPC/receipt/reconciliation migration and replacement copy RPC definitions                       |
| `src/lib/community.functions.ts`                                                | Remove generic aggregate writes; use trusted views/moderation; return authoritative values; omit publication timestamps       |
| `src/lib/collections.functions.ts`                                              | Omit system publication timestamp on owner publishing                                                                         |
| `src/lib/marketplace-errors.ts`                                                 | Small fixed SQL/RPC-to-user error mapping, using the existing HTTP error mechanism rather than changing global error handling |
| `src/integrations/supabase/types.ts`                                            | Regenerate local RPC types; do not manually falsify table types to simulate privileges                                        |
| `supabase/tests/marketplace_boundaries.sql`                                     | Extend approved privilege/RPC/trigger assertions as implementation becomes concrete                                           |
| `tests/marketplace-boundaries.test.mjs`                                         | Keep regressions, add locked overlap/cascade and publication transition cases                                                 |
| `tests/marketplace-errors.test.ts`                                              | Validate safe error mapping for the new trusted paths                                                                         |
| `.github/workflows/database-integrity.yml`                                      | Run the new local fixture/error tests and include `tests/**` in path filters                                                  |
| `docs/marketplace-boundary-design.md`                                           | Record approved choices, implemented contracts and final verification                                                         |

No frontend architectural rewrite, package/lockfile/dependency/README change,
account deletion edit, or changes to old migrations are proposed. Existing
security SQL files should stay unchanged unless a fixture is proven to depend
on an intentionally removed owner privilege; any such exception must be called
out during the implementation review.

**Stop point reached:** review the design and proposed semantics before any
production-behavior change is implemented.
