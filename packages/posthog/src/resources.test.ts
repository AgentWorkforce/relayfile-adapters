import assert from "node:assert/strict";
import test from "node:test";

import { POSTHOG_RESOURCE_PATHS } from "./resource-paths.generated.js";
import {
  findResourceByPath,
  readOnlyResources,
  resources,
} from "./resources.js";

test("PostHog remains read-only in the writeback catalog", () => {
  assert.deepEqual(resources, []);
  assert.equal(readOnlyResources.length, 8);
});

test("read-only discovery resources derive names and paths from the mapping", () => {
  assert.deepEqual(
    Object.fromEntries(
      readOnlyResources.map((resource) => [resource.name, resource.path]),
    ),
    POSTHOG_RESOURCE_PATHS,
  );
  for (const resource of readOnlyResources) {
    assert.match(resource.sampleIndexPath ?? "", /\/_index\.json$/u);
  }
});

test("resource lookup accepts slug-and-id canonical paths", () => {
  assert.equal(
    findResourceByPath(
      "/posthog/projects/17/dashboards/checkout-funnel__73.json",
    )?.name,
    "dashboards",
  );
  assert.equal(findResourceByPath("/posthog/projects/17/by-id/73.json"), undefined);
});
