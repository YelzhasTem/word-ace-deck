import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const protectedTables = new Set([
  "card_progress",
  "delayed_recall_entries",
  "last_studied_decks",
  "speed_runs",
  "streak_days",
  "study_events",
  "study_question_options",
  "study_questions",
  "study_session_cards",
  "study_sessions",
]);
const answerSnapshotTables = new Set([
  "study_question_options",
  "study_questions",
  "study_session_cards",
]);
const mutationMethods = new Set(["delete", "insert", "update", "upsert"]);
const serverOwnedPrivateFields = new Set(["last_active_date", "streak_days", "total_xp"]);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function fromTarget(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (
      node.expression.name.text === "from" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      return node.arguments[0].text;
    }
    return fromTarget(node.expression.expression);
  }
  if (ts.isPropertyAccessExpression(node)) return fromTarget(node.expression);
  return null;
}

function objectFieldNames(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  return new Set(
    node.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return [];
      }
      if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) {
        return [property.name.text];
      }
      return [];
    }),
  );
}

let auditedMutations = 0;
let auditedAnswerRpcs = 0;
for (const filePath of sourceFiles(path.join(root, "src"))) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        method === "rpc" &&
        node.arguments.length >= 2 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments[0].text === "record_study_answer"
      ) {
        auditedAnswerRpcs += 1;
        const fields = objectFieldNames(node.arguments[1]);
        assert.ok(fields, `${path.relative(root, filePath)} uses dynamic study-answer RPC args`);
        assert.equal(
          fields.has("p_result"),
          false,
          `${path.relative(root, filePath)} sends trusted p_result to record_study_answer`,
        );
        assert.equal(
          fields.has("p_question_id"),
          true,
          `${path.relative(root, filePath)} does not bind the answer to a server question`,
        );
      }
      if (mutationMethods.has(method)) {
        const table = fromTarget(node.expression.expression);
        if (table) {
          auditedMutations += 1;
          assert.equal(
            protectedTables.has(table),
            false,
            `${path.relative(root, filePath)} directly ${method}s trusted table ${table}`,
          );

          if (table === "profile_private" && method !== "delete") {
            const fields = objectFieldNames(node.arguments[0]);
            assert.ok(
              fields,
              `${path.relative(root, filePath)} has a dynamic profile_private mutation`,
            );
            for (const field of fields) {
              assert.equal(
                serverOwnedPrivateFields.has(field),
                false,
                `${path.relative(root, filePath)} writes server-owned profile_private.${field}`,
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const typesSource = fs.readFileSync(path.join(root, "src/integrations/supabase/types.ts"), "utf8");
for (const requiredType of [
  "study_sessions",
  "study_session_cards",
  "study_questions",
  "study_question_options",
  "start_study_session",
  "issue_study_question",
  "record_study_answer",
  "complete_study_session",
]) {
  assert.match(typesSource, new RegExp(`\\b${requiredType}\\b`), `Missing ${requiredType} type`);
}
assert.doesNotMatch(
  typesSource,
  /p_result:\s*boolean/,
  "Generated database types expose the removed trusted study result parameter",
);
for (const route of ["type", "recall", "speed", "deep"]) {
  const routeSource = fs.readFileSync(path.join(root, `src/routes/${route}.$deckId.tsx`), "utf8");
  for (const forbidden of ["isCloseMatch", "correctIndex", "recordAnswer("]) {
    assert.equal(
      routeSource.includes(forbidden),
      false,
      `${route} mode still determines server-verifiable correctness with ${forbidden}`,
    );
  }
}

const studyClientSource = fs.readFileSync(path.join(root, "src/lib/study-session.ts"), "utf8");
assert.doesNotMatch(studyClientSource, /\.rpc\("record_study_answer_v2"/);
assert.doesNotMatch(studyClientSource, /p_result/);
for (const required of [
  "p_submitted_answer",
  "p_selected_option_id",
  "p_self_reported_result",
  "p_question_id",
]) {
  assert.match(studyClientSource, new RegExp(required), `Study client is missing ${required}`);
}

const trustedMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260729180000_trusted_study_write_api.sql"),
  "utf8",
);
for (const fragment of [
  "SECURITY DEFINER",
  "idempotency_key",
  "study_events_user_idempotency_key_idx",
  "study_events_deck_card_fkey",
  "response_ms >= 0",
]) {
  assert.match(trustedMigration, new RegExp(fragment), `Trusted migration is missing ${fragment}`);
}

const lockMigrationPath = path.join(
  root,
  "supabase/migrations/20260729210000_close_direct_study_writes.sql",
);
if (fs.existsSync(lockMigrationPath)) {
  const lockMigration = fs.readFileSync(lockMigrationPath, "utf8");
  for (const table of protectedTables) {
    if (answerSnapshotTables.has(table)) continue;
    assert.match(
      lockMigration,
      new RegExp(`REVOKE[^;]+${table}`, "i"),
      `Final lock migration does not revoke writes to ${table}`,
    );
  }
}

const verificationMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260729223000_add_server_verified_study_answers.sql"),
  "utf8",
);
for (const fragment of [
  "study_session_cards",
  "study_questions",
  "study_question_options",
  "expected_answer_snapshot",
  "verification_type",
  "Selected option was not issued for this question",
  "is_study_answer_correct",
]) {
  assert.match(
    verificationMigration,
    new RegExp(fragment),
    `Server-verification migration is missing ${fragment}`,
  );
}

const finalMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260729233000_remove_legacy_boolean_study_answer.sql"),
  "utf8",
);
for (const fragment of [
  "SET SCHEMA private",
  "private.apply_study_answer_result",
  "REVOKE ALL ON FUNCTION private.apply_study_answer_result",
  "Legacy public boolean study-answer signature still exists",
]) {
  assert.match(finalMigration, new RegExp(fragment), `Final migration is missing ${fragment}`);
}

assert.ok(auditedMutations > 0, "No Supabase mutations were audited");
assert.ok(auditedAnswerRpcs > 0, "No canonical study-answer RPC call was audited");
console.log(`Study integrity static audit passed (${auditedMutations} mutations checked).`);
