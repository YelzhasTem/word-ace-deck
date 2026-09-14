# Marketplace moderation and aggregate security

Date: 2026-09-14. Status: implemented and verified locally; awaiting independent review.

Repository: `YelzhasTem/word-ace-deck`. Baseline HEAD:
`e72a5b6914b9c38606c2e67c196efcd4c069ec05`.
Branch: `codex/harden-marketplace-boundaries`.
Checkout: `/Users/baytime/Documents/memora-marketplace-boundaries`.

No commit, push, PR, merge, production query/migration, deployment, or secret
change was performed. The pre-existing dirty checkout at
`/Users/baytime/Documents/memora` was not edited. Account deletion, dependencies,
lockfiles, existing migrations and unrelated frontend code are unchanged.

## 1. Root cause and evidence

Table-wide INSERT/UPDATE privileges exposed every deck/collection column.
Owner RLS protected rows, not columns. A real owner JWT could set or clear
`hidden_at`, supply protected values on INSERT, forge all six counters, and
backdate publication. Clearing a fixture admin's moderation timestamp made the
resource readable to anon again, for both decks and collections.

Non-owner like/rating rows could be saved successfully while the next request
to update the parent counters affected no rows under owner RLS. Several paths
ignored that result. The view path had the same problem and used a racy
read-modify-write. Admin hiding also encountered a post-update RLS failure;
report status and content moderation were independent operations.

Before changing behavior, the local regression suite reported 9 passes and
52 failures out of 61: 42 failures exercised existing behavior, while 10
specified the missing trusted RPC contracts. The initial catalog contract
suite reported 22 passes and 58 failures out of 80. Existing SQL tests passed.
These are local reproductions with synthetic accounts, not production probes.

The complete baseline schema/policy/function sources and write inventory are
preserved in [the design report](marketplace-boundary-design.md), sections B-C.

## 2. Field authority

| Classification | Deck fields | Collection fields |
| --- | --- | --- |
| OWNER_EDITABLE | name, description, cover_color, target_language, definition_language, visibility, category, keywords | name, description, visibility, keywords |
| ADMIN_ONLY | hidden_at | hidden_at |
| SYSTEM_DERIVED | learner_count, like_count, rating_sum, rating_count, view_count, copy_count | Same six fields |
| SERVER_CONTROLLED | id, user_id, created_at, updated_at, published_at, source_deck_id | id, user_id, created_at, updated_at, published_at, source_collection_id |

Direct creation may supply only its own `user_id`, enforced by existing INSERT
RLS. Ownership is immutable afterward. Direct creation starts private; explicit
owner publication sets the timestamp in PostgreSQL. The trusted atomic creation
and copy RPCs keep their existing contracts and private defaults.

Likes/saves/follows allow the actor to insert/delete their own relation. A
rating's value is mutable, but its ID, actor and target are immutable. Reports
accept only target, reporter and reason; status/review time are admin-only.

## 3. Complete protected-field write inventory

| Former writer | Fields | Replacement/current authority |
| --- | --- | --- |
| getPublicDeckDetails | decks.view_count | record_marketplace_view RPC, then returned counter |
| toggleDeckLike | decks.like_count | Child INSERT/DELETE trigger; read parent counter |
| rateDeck | decks.rating_sum/rating_count | Rating upsert trigger; read parent totals |
| rateCollection | collections.rating_sum/rating_count | Equivalent rating trigger/read |
| updateDeckPublishing | decks.published_at | Visibility-specific database trigger |
| updateCollectionPublishingRecord | collections.published_at | Equivalent database trigger |
| reviewDeckReport | decks.hidden_at, deck_reports.status/reviewed_at | Atomic report-derived admin RPC |
| duplicate_public_deck_atomic | source deck copy_count/learner_count | Existing trusted increments, revised source lock |
| duplicate_public_collection_atomic | source collection and contained decks copy_count/learner_count | Existing trusted increments, consistently ordered source locks |
| Generic authenticated INSERT/UPDATE | All protected columns on both parents | Column ACL allowlists deny them |
| Migration reconciliation | Both parents like_count/rating_sum/rating_count | Authoritative relation rows under locked transaction |
| Trusted Auth/FK cleanup | Like/rating removal | Same child DELETE triggers update surviving parents |

No application writer for collection `hidden_at`, `like_count` or `view_count`
was found in the baseline. These fields are protected regardless: the common
RPCs support collections and collection like/rating triggers are tested. No
new collection UI flow was invented. `rateCollection` exists even though no
frontend caller was found. Collection view counting is available through the
trusted RPC but is not newly wired to an unrelated UI flow.

`toggleDeckSave`, report creation, normal deck/collection edits and
`toggleCreatorFollow` write only actor-owned fields/relations. Saves are not
learner counts. `learner_count` currently means cumulative successful copy
operations, not unique learners or study sessions; this existing meaning is
preserved. There is no separate save/follow aggregate writer.

## 4. Database implementation

Forward migration:
`supabase/migrations/20260914010000_harden_marketplace_mutation_boundaries.sql`.

New private functions:

- `set_marketplace_publication_time`: BEFORE UPDATE OF visibility on both parents.
  Explicit publish, including repeat publication, gets database time; private or
  unlisted clears published_at. Publishing never clears hidden_at.
- `touch_marketplace_updated_at`: replaces only the four existing marketplace
  timestamp triggers. Keeps time monotonic and at least created_at, so existing
  future-dated rows cannot break legitimate writes under the timestamp CHECK.
- `keep_marketplace_rating_identity`: rejects rating retargeting; unchanged
  upsert conflict keys remain compatible with PostgREST.
- `maintain_marketplace_aggregates`: AFTER INSERT/DELETE likes and AFTER
  INSERT/UPDATE/DELETE ratings, for each resource type. Atomic arithmetic updates
  the parent, independent of the interacting user's parent UPDATE permission.

The aggregate trigger is SECURITY DEFINER because authorized child mutations
must update a differently owned parent. Its caller is the child trigger, not a
public RPC, and it accepts no client-supplied SQL or totals. Child RLS is the
authorization boundary. The other three private helpers are SECURITY INVOKER.
All four have fixed `search_path = pg_catalog` and no PUBLIC/anon/authenticated
EXECUTE permission; persistent objects are schema-qualified.

New public RPCs (fixed pg_catalog search path; qualified objects; SECURITY DEFINER):

- `record_marketplace_view(p_resource_type text, p_resource_id uuid) -> integer`.
  Uses auth.uid(), verifies public/unlisted and not hidden, accepts neither an
  actor nor a count. One increment per authenticated actor/resource/UTC day.
  Owner views follow the same rule. Anon views are not counted; the existing
  detail server function already requires user authentication.
- `moderate_marketplace_report(p_resource_type text, p_report_id uuid,
  p_action text) -> (resource_id, report_id, status, hidden_at)`.
  Uses actual database admin membership, not a client role flag. Derives the
  target from the report; hides and resolves it in one transaction. Repeating
  the same action is harmless; conflicting closed-report actions fail. Dismiss
  does not unhide. No generic owner/admin table update is needed.

PUBLIC and anon EXECUTE are revoked; authenticated EXECUTE is explicit on those
two RPCs. Auth is checked again inside them. Existing atomic copy RPCs are
replaced in the forward migration, retaining input/output, idempotency, caps,
privacy and error contracts. Their fixed search path and EXECUTE grants are
explicit. Source FOR SHARE lock upgrades were replaced with update-compatible
locks; collection copies lock overlapping source decks in stable ID order.

New table: `private.marketplace_view_receipts`. One latest-date row per
actor/resource, partial unique indexes for each kind, resource lookup indexes,
RLS enabled, no client privileges. Auth/resource foreign keys cascade, so no
account-deletion code change is needed. No email, prompt, IP or token is stored.
Receipts are retained while the actor and resource exist; dates update in place,
so repeated visits do not create an ever-growing daily log. Service role has
only SELECT/INSERT/UPDATE/DELETE on this table.

## 5. Grants and RLS

Scoped tables: decks, collections, deck_likes, deck_ratings, deck_saves,
deck_reports, collection_likes, collection_ratings, collection_saves,
collection_reports, creator_follows (11 tables).

All old table and column privileges are revoked from PUBLIC, anon and
authenticated before adding explicit allowlists. This removes unnecessary
TRUNCATE, TRIGGER and REFERENCES too. Service-role table access is preserved.

- Anon: SELECT on decks/collections only, filtered by existing public-read RLS.
- Authenticated: SELECT on all 11 scoped tables, still filtered by RLS.
- Parent INSERT: only owner-supplied creation fields, no visibility/system fields.
- Parent UPDATE: only the OWNER_EDITABLE fields listed above.
- DELETE: parents, own likes/saves/follows only, subject to existing RLS.
- Likes/saves: INSERT target/user only. Follows: INSERT creator/follower only.
- Ratings: INSERT target/user/rating; UPDATE the same keys for SDK upsert
  compatibility, with the identity trigger preventing actual key changes.
- Reports: INSERT target/reporter/reason only. No generic authenticated UPDATE.

RLS stays enabled throughout. Two owner UPDATE policies have explicit matching
USING/WITH CHECK expressions. Four legacy admin generic-update policies are
removed: Admins hide reported decks/collections; Admins update reports/collection
reports. Eight interaction policies now explicitly require a visible nonhidden
public/unlisted parent: like/save INSERT and rating INSERT/UPDATE for each kind.
Deleting one's existing like/save after moderation remains allowed.
Read policies and all unrelated RLS policies are unchanged.

## 6. Reconciliation and existing data

The migration locks the 11 tables in one transaction, with a 5-second lock
timeout and 120-second statement timeout. Only parent updated_at triggers are
temporarily suspended within the locked transaction during reconciliation.
Like and rating totals are rebuilt from their authoritative relation rows,
including zero totals. Content, publication times, source rows, saves and
original timestamps are preserved. Any failure rolls back DDL and DML together.

Historical view/copy/learner values cannot be reconstructed exactly: there is
no full event history, and surviving copies are not cumulative copy operations.
These values are preserved, not declared trustworthy retrospectively. Resetting
them or inventing a reconstruction requires a separate explicit product/data
decision. Historical arbitrary published/created timestamps are not rewritten.

The local upgrade rehearsal creates four inconsistent synthetic legacy
resources on the previous migration version, applies this forward migration,
and checks correct totals plus exact preservation of other fields/source rows.
It passed with the final migration. Production backfill has NOT been run.

## 7. Application and error handling

`src/lib/community.functions.ts` replaces the direct protected writes listed
above. Child mutation and counter update are one database transaction; the
subsequent display read may naturally see a later concurrent interaction.
The average returned to the UI is calculated from authoritative database totals,
never sent back as an authoritative aggregate. A read failure cannot undo a
successful interaction, but no longer leaves a stale aggregate behind.

`src/lib/collections.functions.ts` omits client publication timestamps.
`src/lib/marketplace-errors.ts` maps fixed errors to safe 401/403/404/409/422/500
responses without reflecting SQL, constraint names, paths or arbitrary text.
Existing report reason validation remains unchanged. The moderation server
input retains deckId for frontend compatibility, but does not trust it as the
target. No frontend redesign or admin service key was added.

Supabase types were regenerated locally and the new RPC signatures merged into
`src/integrations/supabase/types.ts`, preserving existing nullable-result
corrections rather than replacing them with inaccurate generator output.

## 8. Tests and validation

| Check | Final local result |
| --- | --- |
| Fresh local rebuild through all 33 migrations | PASS |
| Database lint, --local --level warning | PASS, no errors |
| All SQL tests | PASS: 316 assertions in 4 files, including 166 new marketplace assertions |
| New real SDK/PostgREST/RPC integration tests | PASS: 75/75, three consecutive complete runs |
| New safe-error unit and AST boundary tests | PASS: 5/5 |
| Existing database integrity/static and report units | PASS, 5 report tests |
| Existing profile privacy static + temporary-user fixture | PASS |
| Existing study integrity static + temporary-user fixture | PASS |
| Existing AI static + unit + quota/RLS fixture | PASS, 13 AI unit tests; no paid provider calls |
| Existing atomic creation static + unit + concurrency fixture | PASS, 3 unit tests |
| Collection report validation fixture | PASS |
| Upgrade/backfill rehearsal | PASS, four legacy resources, unchanged unrelated data |
| TypeScript typecheck | PASS |
| Scoped ESLint, including new script/tests | PASS |
| NITRO_PRESET=vercel npm run build | PASS, .vercel/output |
| Client output identifier scan | 77 JS/HTML files, zero service-role/Gemini/admin-client identifier hits |
| GitHub Actions | Not run: no push or PR authorized |

The integration suite covers both resource types: owner INSERT/UPDATE forgery,
owner publication and editing, second-user likes/unlikes/ratings, repeated rating
upserts, authenticated views/replay, concurrent likes/ratings/views/copies,
report forgery, ordinary-user moderation denial, real admin hiding, owner's
failed unhide/re-publish bypass, anon hidden-read denial, private/hidden
interaction denial, upsert identity immutability, future timestamps, overlapping
copy collections, actor identity, private receipt isolation and Auth cascade
counter cleanup. It includes full owner A -> visitor B -> admin flows.

One intermediate rating-upsert timestamp CHECK failure led to the monotonic
marketplace timestamp helper and dedicated regression cases. The final suite
passed three consecutive runs. A lint attempt run concurrently with SQL test
extension setup failed; the final serialized lint succeeded. CI executes those
steps serially. Existing build warnings concern dependency use-client directives,
bundle size and bundler warnings, not a new server/client boundary error.

Fixtures use only synthetic local users, remove their data, and never email or
call production. The reconciliation script explicitly refuses non-local URLs,
requires a destructive-local-reset opt-in, and refuses a nonempty local stack.
It must run after other fixtures, never concurrently. All temporary local Auth
users and marketplace data were verified absent after testing.

`.github/workflows/database-integrity.yml` runs the new static/unit tests, scoped
lint, all SQL tests, 75 integration tests and the final upgrade rehearsal on the
existing isolated Supabase CI stack. Tests are included in path filters. No
package file change was needed. Full repository-wide ESLint and browser UI
automation were not part of this scoped verification.

## 9. Exact file scope

Modified:

- `.github/workflows/database-integrity.yml`
- `src/integrations/supabase/types.ts`
- `src/lib/collections.functions.ts`
- `src/lib/community.functions.ts`

Added (untracked until separately approved staging):

- `docs/marketplace-boundary-design.md`
- `docs/marketplace-security.md`
- `scripts/verify-marketplace-reconciliation.mjs`
- `src/lib/marketplace-errors.ts`
- `supabase/migrations/20260914010000_harden_marketplace_mutation_boundaries.sql`
- `supabase/tests/marketplace_boundaries.sql`
- `tests/marketplace-boundaries.test.mjs`
- `tests/marketplace-errors.test.ts`
- `tests/marketplace-static.test.mjs`

## 10. Rollout and rollback plan (not executed)

1. Independently review this diff, then authorize PR/CI/preview separately.
   Confirm live schema and migration history match the expected predecessor;
   inventory other deployed clients and all admin tooling that writes these fields.
2. Record production baseline counts, ACLs/policies, authoritative like/rating
   totals and current cumulative view/copy/learner totals. Plan a short coordinated
   write-maintenance window; estimate the table-lock/backfill cost on real sizes.
3. Build/test the compatible server release against an isolated migrated preview
   database. Do not point destructive fixtures at production or a shared preview.
4. During authorized rollout, stop/drain affected writes, apply only this forward
   transaction and deploy the matching server functions before reopening writes.
   Old functions still writing protected fields will fail under the new ACLs;
   do not leave them serving an extended mixed-version window. Publication and
   moderation require the new server release. No permissive fallback is provided.
5. Repeat two-user/admin/anon smoke tests and check Auth cleanup, counters,
   publication, copy idempotency, logs and grants. Only then end maintenance.

Before COMMIT, any lock/DDL/backfill error rolls back the migration. After a
successful COMMIT, prefer a forward correction or a compatible application
rollback that still uses the trusted boundaries. Do not restore broad UPDATE or
legacy counter-writing handlers, disable triggers, or blindly overwrite current
totals with pre-rollout snapshots. Recover like/rating aggregates from current
source rows under a reviewed locked transaction if needed. If a severe failure
requires restoration, suspend marketplace writes and use the approved database
backup/recovery process, accounting explicitly for intervening real activity.

## 11. Remaining risks and separate work

- Production schema drift/runtime behavior and GitHub CI are unverified in this
  task. The security fix is locally validated, not deployed or production-closed.
- Historical view/copy/learner totals and publication/creation timestamps may
  already have been forged; no complete historical ledger can prove them accurate.
- Valid interactions are not proof of human intent. Daily view deduplication and
  existing copy idempotency prevent simple replay, not multi-account abuse. New
  valid copy keys still count new copies as the existing product specifies.
- Daily view deduplication is an explicit bounded counting rule. Repeated same-day
  reads no longer increment, while repeat explicit publication still refreshes
  published_at as before. Stakeholders should review these documented semantics.
- This migration serializes competing writes on hot parent rows. That prevents
  lost increments but deserves normal production latency/lock monitoring.
- Private receipts retain internal user references until actor/resource deletion;
  volume is bounded per pair, not globally. Revisit retention if actual scale or
  policy requires it, without silently weakening replay protection.
- Five unrelated tables retain broad REFERENCES/TRIGGER/TRUNCATE privilege debt:
  card_associations, collection_decks, deck_learning_settings, friendships and
  user_roles. They were not modified; catalog privileges alone do not prove a
  remotely callable exploit. Audit their own boundaries separately.
- Direct REST constraint messages and unrelated legacy error handling were not
  globally redesigned. Updated application paths return only safe mapped errors.

The requested owner-forgery, moderation-bypass and lost-aggregate paths are
closed at the local code/database boundary and protected by regression tests.
Independent review and explicitly authorized production rollout remain required.
