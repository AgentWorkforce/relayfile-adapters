import assert from "node:assert/strict";
import test from "node:test";

import { GCP_LAYOUT_PROMPT, layoutPromptFile } from "./layout-prompt.js";

test("GCP LAYOUT.md is provider-specific and documents indexes, aliases, and examples", () => {
  const file = layoutPromptFile();

  assert.equal(file.path, "/gcp/LAYOUT.md");
  assert.equal(file.contentType, "text/markdown; charset=utf-8");
  assert.ok(Buffer.byteLength(GCP_LAYOUT_PROMPT, "utf8") >= 1000);
  assert.match(GCP_LAYOUT_PROMPT, /\/gcp\/run\/services\/_index\.json/u);
  assert.match(GCP_LAYOUT_PROMPT, /\/gcp\/monitoring\/alerts\/_index\.json/u);
  assert.match(GCP_LAYOUT_PROMPT, /\/gcp\/billing\/_index\.json/u);
  assert.match(GCP_LAYOUT_PROMPT, /\/gcp\/error-reporting\/groups\/_index\.json/u);
  assert.match(GCP_LAYOUT_PROMPT, /by-region/u);
  assert.match(GCP_LAYOUT_PROMPT, /by-state/u);
  assert.match(GCP_LAYOUT_PROMPT, /by-service/u);
  assert.match(GCP_LAYOUT_PROMPT, /\bjq\b/u);
  assert.match(GCP_LAYOUT_PROMPT, /\bls\b/u);
});
