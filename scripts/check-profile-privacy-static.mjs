import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const typesPath = path.join(root, "src/integrations/supabase/types.ts");
const typesSource = fs.readFileSync(typesPath, "utf8");
const typesFile = ts.createSourceFile(
  typesPath,
  typesSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const allowedPublicProfileFields = [
  "avatar_url",
  "created_at",
  "display_name",
  "id",
  "updated_at",
  "user_id",
  "username",
];

function propertyName(member) {
  if (!member.name) return null;
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return member.name.text;
  return null;
}

function typeProperty(typeNode, name) {
  assert.ok(ts.isTypeLiteralNode(typeNode), `${name} parent is not a type literal`);
  const member = typeNode.members.find(
    (candidate) => ts.isPropertySignature(candidate) && propertyName(candidate) === name,
  );
  assert.ok(member?.type, `Generated database types are missing ${name}`);
  return member.type;
}

function typeFieldNames(typeNode) {
  assert.ok(ts.isTypeLiteralNode(typeNode), "Expected a generated row type literal");
  return typeNode.members.filter(ts.isPropertySignature).map(propertyName).filter(Boolean).sort();
}

const databaseAlias = typesFile.statements.find(
  (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "Database",
);
assert.ok(databaseAlias, "Generated types are missing Database");
const publicSchema = typeProperty(databaseAlias.type, "public");
const tables = typeProperty(publicSchema, "Tables");
const profiles = typeProperty(tables, "profiles");
const profileRow = typeProperty(profiles, "Row");
assert.deepEqual(
  typeFieldNames(profileRow),
  allowedPublicProfileFields,
  "public.profiles contains a field that has not passed the privacy review",
);

const profilePrivate = typeProperty(tables, "profile_private");
const privateFields = typeFieldNames(typeProperty(profilePrivate, "Row"));
assert.equal(
  privateFields.includes("email"),
  false,
  "profile_private must not duplicate Auth email",
);
assert.ok(
  privateFields.includes("username_privacy_review_needed"),
  "profile_private is missing the username privacy review flag",
);

const functions = typeProperty(publicSchema, "Functions");
assert.doesNotMatch(
  functions.getText(typesFile),
  /\bemail\b/i,
  "A generated public RPC signature exposes an email field",
);
const views = typeProperty(publicSchema, "Views");
assert.doesNotMatch(
  views.getText(typesFile),
  /\bemail\b/i,
  "A generated public view exposes an email field",
);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function chainTargetsProfiles(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (
      node.expression.name.text === "from" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === "profiles"
    ) {
      return true;
    }
    return chainTargetsProfiles(node.expression.expression);
  }
  if (ts.isPropertyAccessExpression(node)) return chainTargetsProfiles(node.expression);
  return false;
}

let publicProfileSelectCount = 0;

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
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "select" &&
      chainTargetsProfiles(node.expression.expression)
    ) {
      publicProfileSelectCount += 1;
      const selection = node.arguments[0];
      assert.ok(
        selection && ts.isStringLiteralLike(selection),
        `${path.relative(root, filePath)} has a dynamic or implicit profiles select`,
      );
      assert.doesNotMatch(
        selection.text,
        /(^|,)\s*\*/,
        `${path.relative(root, filePath)} uses select("*") for profiles`,
      );
      assert.doesNotMatch(
        selection.text,
        /\bemail\b/i,
        `${path.relative(root, filePath)} selects profiles.email`,
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

assert.ok(publicProfileSelectCount > 0, "No public profile selects were audited");
console.log(`Profile privacy static audit passed (${publicProfileSelectCount} profile selects).`);
