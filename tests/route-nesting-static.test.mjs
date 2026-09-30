import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// A file like routes/community.$deckId.tsx is nested inside routes/community.tsx. If the parent
// page renders no <Outlet />, the child URL opens but still shows the parent page.
test("every nested route has a parent that renders an Outlet", () => {
  const tree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  const files = new Map(
    [...tree.matchAll(/import \{ Route as (\w+)Import \} from '\.\/routes\/([^']+)'/g)].map(
      ([, name, file]) => [name, file],
    ),
  );
  const nested = [
    ...tree.matchAll(
      /const (\w+) = \w+Import\.update\(\{[^}]*?getParentRoute: \(\) => (\w+)Route,/g,
    ),
  ].map(([, child, parent]) => ({ child, parent: `${parent}Route` }));

  for (const { child, parent } of nested) {
    const parentFile = files.get(parent);
    assert.ok(parentFile, `${child}: parent ${parent} not found in routeTree.gen.ts`);
    const source = readFileSync(
      new URL(`../src/routes/${parentFile}.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /<Outlet\b/,
      `${child} is nested in routes/${parentFile}.tsx, which renders no <Outlet />. ` +
        "Rename the child file with a trailing underscore (for example community_.$deckId.tsx).",
    );
  }
});

test("the Community deck page is a top-level route", () => {
  const tree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  assert.match(
    tree,
    /CommunityDeckIdRoute = CommunityDeckIdRouteImport\.update\(\{\s*id: '\/community_\/\$deckId',\s*path: '\/community\/\$deckId',\s*getParentRoute: \(\) => rootRouteImport,/,
  );
});
