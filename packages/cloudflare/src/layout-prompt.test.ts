import assert from "node:assert/strict";
import test from "node:test";

import { CLOUDFLARE_LAYOUT_PROMPT, layoutPromptFile } from "./layout-prompt.js";

test("Cloudflare LAYOUT.md documents indexes, aliases, and discovery contracts", () => {
  const file = layoutPromptFile();

  assert.equal(file.path, "/cloudflare/LAYOUT.md");
  assert.equal(file.contentType, "text/markdown; charset=utf-8");
  assert.ok(Buffer.byteLength(CLOUDFLARE_LAYOUT_PROMPT, "utf8") >= 1000);
  assert.match(file.content, /\/cloudflare\/workers\/scripts\/_index\.json/u);
  assert.match(file.content, /\/cloudflare\/analytics\/workers\/scripts\/_index\.json/u);
  assert.match(file.content, /\/cloudflare\/zones\/<zoneId>\/dns-records\//u);
  assert.match(file.content, /\/cloudflare\/notifications\/events\//u);
  assert.match(file.content, /by-id/u);
  assert.match(file.content, /\bls\b/u);
});
