import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("editorial labels describe utility without internal production language", () => {
  const resources = read("../src/lib/wave2-founder-resources.ts");
  assert.doesNotMatch(resources, /2,?000\+?\s*word/i);
});

test("public trust pages stay accessible to signed-out visitors", () => {
  const proxy = read("../src/proxy.ts");
  for (const route of ["/about", "/contact", "/privacy", "/terms"]) {
    assert.match(proxy, new RegExp(`\"${route}\"`));
  }
});

test("site metadata provides a large social image", () => {
  const layout = read("../src/app/layout.tsx");
  assert.match(layout, /images:\s*\[\"\/og-image\.png\"\]/);
  assert.match(layout, /card:\s*\"summary_large_image\"/);
});
