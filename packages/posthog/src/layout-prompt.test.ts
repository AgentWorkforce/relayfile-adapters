import assert from "node:assert/strict";
import test from "node:test";

import { layoutPromptFile } from "./layout-prompt.js";

test("PostHog layout documents canonical paths, aliases, and terminal states", () => {
  const layout = layoutPromptFile();
  assert.equal(layout.path, "/posthog/LAYOUT.md");
  assert.equal(layout.contentType, "text/markdown; charset=utf-8");
  assert.ok(layout.content.length >= 1_000);
  assert.match(layout.content, /<slug>__<id>\.json/u);
  assert.match(layout.content, /by-name/u);
  assert.match(layout.content, /by-short-id/u);
  assert.match(layout.content, /by-key/u);
  assert.match(layout.content, /terminal state is not a deletion/u);
  assert.match(layout.content, /jq /u);
});
