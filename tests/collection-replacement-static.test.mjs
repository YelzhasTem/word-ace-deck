import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

test("collection replacement uses only the authenticated atomic RPC, never separate writes", () => {
  const source = ts.createSourceFile(
    "collections.functions.ts",
    readFileSync(new URL("../src/lib/collections.functions.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let declaration;
  function find(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "setCollectionDecksRecord"
    ) {
      declaration = node.initializer;
    }
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(declaration);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      calls.push({ name: node.expression.name.text, args: node.arguments });
    }
    ts.forEachChild(node, visit);
  }
  visit(declaration);
  assert.equal(
    calls.filter(({ name }) => ["from", "insert", "delete", "upsert"].includes(name)).length,
    0,
  );
  const rpc = calls.filter(({ name }) => name === "rpc");
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].args[0].text, "replace_collection_decks_atomic");
  assert.match(declaration.getText(source), /requireSupabaseAuth/);
  assert.match(declaration.getText(source), /getCollectionReplacementError/);
  assert.match(declaration.getText(source), /\.max\(500\)/);
});
