import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { expectRoundTripFixture } from "./harness.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(
  testDir,
  "../../fixtures/round-trip/github-pulls/manifest.json"
);

describe("GitHub pull-request listing round trip", () => {
  test("snapshot matches the GitHub pull-request listing fixture", async () => {
    await expectRoundTripFixture(manifestPath);
  });
});
