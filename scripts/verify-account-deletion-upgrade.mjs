import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { requireLocalDeletionFixture } from "./account-deletion-local-guard.ts";
import { deletionFixtureSql as sql, fixtureUuid as uuid } from "./account-deletion-fixture-db.ts";

requireLocalDeletionFixture(process.env.SUPABASE_URL);
assert.equal(
  process.env.ACCOUNT_DELETION_RESET_LOCAL,
  "true",
  "Explicit disposable local reset opt-in required",
);
assert.equal(
  sql("SELECT count(*) FROM auth.users"),
  "0",
  "Refuse reset of a local stack with users",
);
assert.equal(
  sql("SELECT (SELECT count(*) FROM public.decks)+(SELECT count(*) FROM public.collections)"),
  "0",
);
function cli(args) {
  const bin = process.env.SUPABASE_LOCAL_CLI;
  try {
    return execFileSync(bin || "npx", bin ? args : ["--yes", "supabase@2.110.0", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 240_000,
    });
  } catch {
    throw new Error("Local Stage 3 upgrade command failed; inspect disposable local stack");
  }
}
cli(["db", "reset", "--local", "--version", "20260915010000"]);
const userA = randomUUID();
const userB = randomUUID();
const deck = randomUUID();
const collection = randomUUID();
const tables =
  sql(`SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private') ORDER BY 1`).split("\n");
function snapshot() {
  return tables.map((table) => {
    assert.match(table, /^(public|private)\.[a-z_]+$/);
    return sql(`SELECT md5(coalesce(string_agg(row_value, E'\\n' ORDER BY row_value),''))
      FROM (SELECT row_to_json(t)::text row_value FROM ${table} t) snapshot_rows`);
  });
}
try {
  sql(`INSERT INTO auth.users(id,raw_user_meta_data) VALUES
    (${uuid(userA)},'{"username":"stage3_upgrade_a"}'),(${uuid(userB)},'{"username":"stage3_upgrade_b"}');
    INSERT INTO public.decks(id,user_id,name,visibility,published_at) VALUES(${uuid(deck)},${uuid(userA)},'Upgrade source','public',now());
    INSERT INTO public.cards(deck_id,user_id,term,definition,position) VALUES(${uuid(deck)},${uuid(userA)},'one','one',0);
    INSERT INTO public.collections(id,user_id,name,visibility,published_at) VALUES(${uuid(collection)},${uuid(userA)},'Upgrade collection','public',now());
    INSERT INTO public.collection_decks(collection_id,deck_id,user_id,position) VALUES(${uuid(collection)},${uuid(deck)},${uuid(userA)},0);
    INSERT INTO public.deck_likes(deck_id,user_id) VALUES(${uuid(deck)},${uuid(userB)});
    INSERT INTO public.deck_ratings(deck_id,user_id,rating) VALUES(${uuid(deck)},${uuid(userB)},4);
    INSERT INTO private.marketplace_view_receipts(user_id,deck_id,viewed_on) VALUES(${uuid(userB)},${uuid(deck)},current_date);`);
  const before = snapshot();
  const history = Number(sql("SELECT count(*) FROM supabase_migrations.schema_migrations"));
  const unchanged = () =>
    sql(`SELECT md5(string_agg(pg_get_functiondef(oid),E'\\n' ORDER BY proname))
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('replace_collection_decks_atomic','create_deck_with_cards','record_marketplace_view','moderate_marketplace_report','duplicate_public_deck_atomic','duplicate_public_collection_atomic')`);
  const functionHash = unchanged();
  const constraints = () =>
    sql(`SELECT md5(string_agg(conname||':'||convalidated::text||':'||pg_get_constraintdef(oid), E'\\n' ORDER BY conrelid,conname))
    FROM pg_constraint WHERE connamespace='public'::regnamespace`);
  const constraintHash = constraints();
  const dry = cli(["db", "push", "--local", "--dry-run"]);
  // CLI versions can emit the filename on stderr; database history is authoritative.
  assert.doesNotMatch(dry, /2026091[45]010000.*\.sql/);
  assert.equal(
    sql(
      "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version > '20260915010000'",
    ),
    "0",
  );
  cli(["db", "push", "--local", "--yes"]);
  assert.equal(
    Number(sql("SELECT count(*) FROM supabase_migrations.schema_migrations")),
    history + 1,
  );
  assert.equal(
    sql("SELECT max(version) FROM supabase_migrations.schema_migrations"),
    "20260916010000",
  );
  assert.deepEqual(snapshot(), before, "Stage 3 must preserve every existing application row");
  assert.equal(unchanged(), functionHash, "Stage 1/2 RPC bodies must remain unchanged");
  assert.equal(
    sql(`SELECT has_column_privilege('authenticated','public.decks','hidden_at','UPDATE')
    OR has_column_privilege('authenticated','public.collections','like_count','UPDATE')`),
    "f",
  );
  assert.equal(
    constraints(),
    constraintHash,
    "Preserve existing constraints including two intentionally NOT VALID local Auth FKs",
  );
  console.log(
    `PASS Stage 2 -> Stage 3 only: ${tables.length} table snapshots, six RPC bodies, protected grants and constraint validation states preserved`,
  );
} finally {
  sql(`DELETE FROM auth.users WHERE id IN (${uuid(userA)},${uuid(userB)})`);
  assert.equal(
    sql(`SELECT count(*) FROM auth.users WHERE id IN (${uuid(userA)},${uuid(userB)})`),
    "0",
  );
  assert.equal(
    sql(`SELECT count(*) FROM public.decks WHERE user_id IN (${uuid(userA)},${uuid(userB)})`),
    "0",
  );
}
