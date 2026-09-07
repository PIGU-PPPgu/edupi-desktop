import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("App Router dynamic siblings use one parameter name", () => {
  const seen = new Map();
  const visit = (directory, segments = []) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const next = [...segments, entry.name];
      if (entry.name.startsWith("[")) {
        const key = next.map(segment => segment.startsWith("[") ? "[]" : segment).join("/");
        const previous = seen.get(key);
        assert.ok(!previous || previous === entry.name, `${key}: conflicting ${previous} and ${entry.name}`);
        seen.set(key, entry.name);
      }
      visit(path.join(directory, entry.name), next);
    }
  };
  visit(fileURLToPath(new URL("../app", import.meta.url)));
});
