import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutPromptFile } from "./layout-prompt.js";

describe("daytona layout prompt", () => {
  it("emits the integration layout guide at the daytona root", () => {
    const file = layoutPromptFile();

    assert.equal(file.path, "/daytona/LAYOUT.md");
    assert.equal(file.contentType, "text/markdown; charset=utf-8");
    assert.ok(
      file.content.length >= 1000,
      `content length ${file.content.length} is below 1000-byte minimum`,
    );
    assert.match(file.content, /\bls\b/u);
    assert.match(file.content, /\bjq\b/u);
    assert.match(file.content, /_index\.json/u);
    assert.match(file.content, /by-id/u);
  });
});
