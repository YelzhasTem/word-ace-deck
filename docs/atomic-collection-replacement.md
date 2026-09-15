# Atomic collection deck replacement

## Scope and original failure

Stage 2 is based on main `4725652e6f4beabfd97e6183f59d0a78477720c6`.
Stage 1 marketplace moderation, column privileges, aggregate triggers, view
receipts, and copy RPCs are unchanged.

The complete replacement call chain is:

1. `src/routes/collections.tsx`: `savePicker`, using the user's library picker.
2. `src/lib/collections.ts`: `useCollections().setCollectionDecks`, React Query
   mutation, existing success invalidation and error toast.
3. `src/lib/collections.functions.ts`: `setCollectionDecksRecord`, authenticated
   server function with UUID validation and an existing 500-ID maximum.
4. Previously: two independent PostgREST requests, DELETE then INSERT.
5. Now: one authenticated `replace_collection_decks_atomic` RPC call.

The old flow was reproduced against disposable local Supabase before the fix.
For each of a foreign public deck, nonexistent deck, and duplicate deck IDs, the
INSERT failed after two previous links had already been deleted. All three
preservation regressions failed. The AST guard also failed on the old handler.
The new SQL suite initially failed because the RPC did not yet exist.

Other writers were inspected: `create_deck_with_cards` appends a link under a
per-collection advisory lock; `duplicate_public_collection_atomic` builds links
within its existing transaction and locks its source collection. Collection and
deck deletion use existing cascades. None is an alternative replacement caller;
none was rewritten. Account deletion was not changed.

## Database contract and authorization

New forward migration:
`20260915010000_atomic_collection_deck_replacement.sql`.

`public.replace_collection_decks_atomic(p_collection_id uuid, p_deck_ids uuid[])`
returns the integer number of replacement links, including zero. The server
function retains its existing `{ ok: true }` response, so the UI contract does not
change. No default collection is created.

- `auth.uid()` is the only user identity. No client-supplied owner parameter.
- `SECURITY INVOKER`, fixed `search_path = pg_catalog`, qualified application
  objects. No privilege elevation or service-role client is needed.
- PUBLIC and anon EXECUTE are revoked; authenticated EXECUTE is granted.
- Existing table grants and RLS are unchanged, including Stage 1's column grants.
- The collection and every deck must belong to the caller. Visibility alone does
  not qualify another user's public deck. Foreign and missing resources use the
  same safe error, avoiding an existence oracle.
- Existing validated composite FKs enforce both `(collection_id, user_id)` and
  `(deck_id, user_id)` ownership; the existing unique pair and nonnegative
  position CHECK remain intact.
- Null arrays/elements and multidimensional arrays are rejected. Empty arrays
  are allowed. Duplicate IDs are explicitly rejected. The existing 500-ID
  request limit is enforced in SQL too; this is not a new table-wide size limit.
- `WITH ORDINALITY` assigns contiguous positions starting at zero, independently
  of PostgreSQL array lower bounds.

The migration creates only the RPC, its grants and comment, within BEGIN/COMMIT.
It performs no data cleanup/backfill, creates no table, changes no historical
migration, and does not change existing constraints, policies or parent fields.

## Transaction and concurrency semantics

Validate the input and collection ownership, then acquire the same transaction
advisory lock used by atomic deck creation:
`hashtextextended(collection_id::text, 52017002)`.
Acquire it before the collection row's `FOR UPDATE` lock. Recheck ownership while
locking that row. Lock selected owned decks in UUID order with `FOR KEY SHARE`,
verify their count, then DELETE and INSERT in this one RPC transaction.

Concurrent replacements serialize per collection. Readers see either the old
committed membership or a complete replacement, never the intermediate delete.
The parent lock also coordinates with collection copy/deletion and FK-backed
link inserts. Atomic deck append shares the advisory lock and runs before or
after replacement. No existing creation/copy function needs replacement.

Any exception, including a failure on the last inserted row, rolls back the
delete and all inserts. Unexpected SQL errors map to
`REPLACE_COLLECTION_DECKS_FAILED`; the server error helper exposes fixed messages
and HTTP 401/403/404/422/500 statuses, not database details.

This is last-serialized-writer-wins replacement, not optimistic revision control.
Replaying the same list is membership-idempotent but recreates link row IDs and
timestamps. A delayed retry can supersede a more recent edit. No retry job,
idempotency table, or promise of conflict detection is introduced. Authorized
direct single-row CRUD remains available under existing RLS/FKs; only complete
replacement is required to use this RPC in application code.

## Permanent regression coverage

- `tests/collection-replacement-static.test.mjs`: AST checks one authenticated
  RPC call, existing batch limit, safe mapping, and no table-write fallback.
- `tests/collection-replacement-errors.test.ts`: two safe error-mapping tests.
- `supabase/tests/collection_replacement.sql`: 24 pgTAP assertions, including
  privileges/RLS/ownership FKs, missing auth, invalid arrays, ownership, ordering,
  empty replacement, and a test-only trigger forcing a late INSERT failure.
  All fixtures and the trigger roll back.
- `tests/collection-replacement.test.mjs`: 15 local-only tests using two real
  synthetic Auth sessions, Supabase JS, raw PostgREST and RPC. Includes 500 links,
  501 rejection, malformed requests, owner spoofing, foreign public decks,
  eight simultaneous replacement pairs, concurrent atomic creation, and a
  deterministic lock gate observing two requests waiting with old rows intact.
  Synthetic users and their cascaded data are removed even after test failures.
- `.github/workflows/database-integrity.yml` runs the new static/unit, scoped
  lint and API suites; its existing SQL step discovers the new pgTAP file.

All integration tests refuse non-local URLs. The lock gate uses the disposable
Docker database `supabase_db_monfppjrvkyepjkfexqm` matching `supabase/config.toml`,
not the linked production database. Never use production credentials for fixtures.

Local commands (Supabase CLI 2.110.0 and Node 24):

```sh
npx --yes supabase@2.110.0 db reset --local
npx --yes supabase@2.110.0 db lint --local --schema public,private --level warning
npx --yes supabase@2.110.0 test db
node --experimental-strip-types --test tests/collection-replacement-errors.test.ts tests/collection-replacement-static.test.mjs
node --env-file=.env.security --test tests/collection-replacement.test.mjs
```

`.env.security` means ignored local fixture credentials exported as in CI. The
optional `COLLECTION_REPLACEMENT_REPRODUCE_LEGACY=true` flag in the test fixture
is only an opt-in red-phase probe of the old two-request algorithm. Normal tests
and CI use only the RPC. There is no application fallback to the old algorithm.

## Rollout and rollback

No production action is part of this implementation. After separate review and
authorization, apply the forward migration before deploying the matching server
function. Existing application code tolerates the additive migration, but is
still non-atomic until updated. A missing RPC fails safely in the new handler;
it never falls back to DELETE/INSERT.

Prefer a forward fix if rollout reveals a problem. A code rollback would restore
the known data-loss bug and should not be the default response. Removing the new
RPC requires first disabling/reverting its caller under separate authorization;
it does not require undoing data changes or weakening Stage 1 grants. Never undo
Stage 1 security as a compatibility workaround.

## Local validation results

Verified on 2026-09-15; no production connection, migration, deployment, commit,
push, or PR was performed for this stage.

| Check | Result |
| --- | --- |
| Before-fix legacy API probe | 3/3 expected failures: old links lost after rejected replacement |
| Before-fix AST check | Expected failure: separate table writes detected |
| New unit/static tests | 3/3 passed |
| Supabase reset from zero | Passed, including the new forward migration |
| Database lint, public and private | Passed, zero findings at warning level |
| All SQL suites | 340/340 passed across 5 files, including 24 new assertions |
| New Supabase JS/PostgREST/RPC suite | 15/15 passed; two-user, late-validation, max batch and concurrency coverage |
| Stage 1 marketplace API suite | 75/75 passed |
| Stage 1 unit/static tests | 5/5 passed |
| `npm run check:database-integrity` | Passed; includes 5 report units and profile/study/AI static checks |
| `npm run check:atomic-deck-creation` | Passed; includes 3 error/key units |
| `npm run check:ai-security` | Passed; includes 13 security/SSRF/image units |
| Collection report API fixture | Passed |
| Atomic deck creation API/concurrency fixture | Passed |
| Profile privacy REST/JS fixture | Passed |
| Study integrity REST/JS/RPC fixture | Passed |
| AI quota/RLS fixture with local config mutation | Passed |
| Existing marketplace upgrade/backfill rehearsal | Passed; four existing synthetic resources and event rows preserved |
| `npm run typecheck` | Passed |
| Scoped ESLint | Passed, zero errors/warnings on the handler and all new TS/MJS files |
| `NITRO_PRESET=vercel npm run build` | Passed; `.vercel/output` produced |
| Client/server boundary spot-check | 77 browser JS chunks contain neither the RPC implementation name, advisory lock code, nor service-role variable |
| GitHub Actions | Tests wired into existing workflow; remote CI not run because no push/PR is authorized |

The SQL rollback test injects a late insert failure; no distributed-transaction
claim is involved. The deterministic concurrency test observed two live requests
waiting on the shared advisory lock while the entire original snapshot remained
unchanged. Eight additional simultaneous pairs finished with exactly one complete
requested set, never a mixture.

Final local fixture counts were zero for Auth users, profiles, profile_private,
decks, cards, collections, links, content creation requests, default collection
mappings, and AI usage. Tests used no production data or real AI provider calls.

Existing warnings were left outside this scope: npm reported 8 dependency audit
findings (2 low, 1 moderate, 5 high) and Recharts deprecation; Vite reported a
625.13 kB client entry chunk and unused imports inside TanStack dependencies.
No dependency, lockfile, package configuration, or global lint debt was changed.
Supabase also reports the existing missing optional `supabase/seed.sql` glob.

## Exact review scope

Modified:

- `.github/workflows/database-integrity.yml`
- `src/integrations/supabase/types.ts` (new generated RPC entry only; existing
  nullable RPC annotations retained after regeneration)
- `src/lib/collections.functions.ts`

Added:

- `docs/atomic-collection-replacement.md`
- `src/lib/collection-replacement-errors.ts`
- `supabase/migrations/20260915010000_atomic_collection_deck_replacement.sql`
- `supabase/tests/collection_replacement.sql`
- `tests/collection-replacement-errors.test.ts`
- `tests/collection-replacement-static.test.mjs`
- `tests/collection-replacement.test.mjs`
