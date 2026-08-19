import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INBOUND_CAPABILITY_CATALOG,
  INBOUND_CAPABILITY_CATALOG_VERSION,
} from "../../src/inbound/index.js";
import {
  generateInboundCapabilityCatalog,
  inboundCapabilityCatalogPaths,
  renderInboundCapabilityCatalogModule,
  validateAdapterPackageInboundCapabilities,
  validateInboundCapabilityCatalog,
} from "../../src/inbound/catalog-generator.js";
import { findRepoRoot } from "../../src/triggers/catalog-generator.js";
import { defineNangoInboundCapability } from "../../src/inbound/types.js";

test("generated inbound capability catalog is in sync with adapter declarations", async () => {
  const repoRoot = await findRepoRoot();
  const generation = await generateInboundCapabilityCatalog(repoRoot);
  const paths = inboundCapabilityCatalogPaths(repoRoot);

  const catalogJson = JSON.parse(await readFile(paths.catalogJson, "utf8"));
  const catalogTs = await readFile(paths.catalogTs, "utf8");

  assert.deepEqual(catalogJson, {
    schema: "relayfile.inbound-capability-catalog/1",
    catalogVersion: generation.catalogVersion,
    capabilities: generation.catalog,
  });
  assert.equal(catalogTs, renderInboundCapabilityCatalogModule(generation));
  assert.deepEqual(INBOUND_CAPABILITY_CATALOG, generation.catalog);
  assert.equal(INBOUND_CAPABILITY_CATALOG_VERSION, generation.catalogVersion);

  assert.deepEqual(
    generation.sources.map((source) => source.providerId),
    ["github", "gitlab", "gmail", "hubspot", "linear", "notion", "shortcut", "slack"],
  );
});

test("catalog rejects one provider id with conflicting path roots", () => {
  const canonical = defineNangoInboundCapability({
    id: "gmail.nango",
    providerId: "gmail",
    pathRoot: "/gmail",
    providerConfigAliases: ["gmail"],
  });
  const conflicting = {
    ...canonical,
    id: "gmail.hookdeck",
    pathRoot: "/google-mail" as const,
    providerConfigAliases: ["google-mail"],
  };

  assert.throws(
    () => validateInboundCapabilityCatalog([canonical, conflicting]),
    /gmail declares conflicting path roots: \/gmail and \/google-mail/u,
  );
});

test("catalog rejects one path root claimed by different provider ids", () => {
  const gmail = defineNangoInboundCapability({
    id: "gmail.nango",
    providerId: "gmail",
    pathRoot: "/gmail",
    providerConfigAliases: ["gmail"],
  });
  const conflicting = {
    ...gmail,
    id: "google-mail.nango",
    providerId: "google-mail",
    providerConfigAliases: ["google-mail"],
  };

  assert.throws(
    () => validateInboundCapabilityCatalog([gmail, conflicting]),
    /path root \/gmail is claimed by both gmail and google-mail/u,
  );
});

test("adapter package rejects declarations with mixed provider ids", () => {
  const gmail = defineNangoInboundCapability({
    id: "gmail.nango",
    providerId: "gmail",
    pathRoot: "/gmail",
    providerConfigAliases: ["gmail"],
  });
  const googleMail = defineNangoInboundCapability({
    id: "google-mail.nango",
    providerId: "google-mail",
    pathRoot: "/google-mail",
    providerConfigAliases: ["google-mail"],
  });

  assert.throws(
    () =>
      validateAdapterPackageInboundCapabilities("packages/gmail", [
        gmail,
        googleMail,
      ]),
    /packages\/gmail\/src\/inbound\.ts must declare exactly one provider id; found gmail, google-mail/u,
  );
});
