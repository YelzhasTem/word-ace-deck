import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const protectedFields = new Set([
  "hidden_at",
  "learner_count",
  "like_count",
  "rating_sum",
  "rating_count",
  "view_count",
  "copy_count",
  "published_at",
]);

for (const file of ["community.functions.ts", "collections.functions.ts"]) {
  test(`${file}: no generic writes to protected marketplace fields`, () => {
    const source = ts.createSourceFile(
      file,
      readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const declarations = new Map();
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        declarations.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
    function checkPayload(node, seen = new Set()) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (ts.isIdentifier(node)) return checkPayload(declarations.get(node.text), seen);
      if (ts.isArrayLiteralExpression(node))
        node.elements.forEach((item) => checkPayload(item, seen));
      if (!ts.isObjectLiteralExpression(node)) return;
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) checkPayload(property.expression, seen);
        else if (
          property.name &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          assert.ok(
            !protectedFields.has(property.name.text),
            `${file} directly writes ${property.name.text}`,
          );
        }
      }
    }
    function inspect(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["insert", "update", "upsert"].includes(node.expression.name.text)
      ) {
        checkPayload(node.arguments[0]);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  });
}
