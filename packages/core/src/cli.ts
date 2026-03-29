#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import {
  ChangeDetector,
  defaultSyncConfig,
} from "./docs/change-detector.js";
import { DocsCrawler } from "./docs/crawler.js";
import { APIExtractor } from "./docs/extractor.js";
import { SpecGenerator } from "./docs/generator.js";
import { MappingGenerator } from "./docs/mapping-generator.js";
import { SpecUpdater } from "./docs/updater.js";
import type {
  DocsLlmConfig,
  DocsSourceConfig,
  DocsSpecMetadata,
  DocsSyncConfig,
} from "./docs/types.js";
import { detectDrift } from "./drift/drift-checker.js";
import { generateAdapterModule } from "./generate/adapter-generator.js";
import { generateTypeDefinitions } from "./generate/types-generator.js";
import { loadServiceSpecFromMapping } from "./ingest/index.js";
import type { ServiceSpec } from "./ingest/types.js";
import {
  loadMappingSpec,
  validateMappingSpec,
} from "./spec/parser.js";
import type { MappingSpec } from "./spec/types.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const flags = parseFlags(args);

  switch (command) {
    case "generate":
      await handleGenerate(flags);
      return;
    case "validate":
      await handleValidate(flags);
      return;
    case "drift":
      await handleDrift(flags);
      return;
    case "init":
      await handleInit(flags);
      return;
    case "docs-to-spec":
      await handleDocsToSpec(flags);
      return;
    case "docs-update":
      await handleDocsUpdate(flags);
      return;
    case "docs-check":
      await handleDocsCheck(flags);
      return;
    case "help":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command "${command}"`);
  }
}

async function handleGenerate(flags: Record<string, string | boolean>): Promise<void> {
  const specPath = requireString(flags.spec, "--spec is required");
  const outdir = requireString(flags.outdir, "--outdir is required");
  const mappingSpec = await loadMappingSpec(specPath);
  const cwd = dirname(resolve(specPath));
  const serviceSpec = await loadServiceSpecFromMapping(mappingSpec, cwd);
  const validation = validateMappingSpec(mappingSpec, serviceSpec);

  if (!validation.valid) {
    throw new Error(renderValidation(validation.issues));
  }

  const adapterCode = generateAdapterModule(mappingSpec, serviceSpec);
  const typesCode = generateTypeDefinitions(serviceSpec);
  const outputDir = resolve(outdir);

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "adapter.generated.ts"), adapterCode);
  await writeFile(resolve(outputDir, "types.generated.ts"), typesCode);
  await writeFile(
    resolve(outputDir, "service-spec.snapshot.json"),
    `${JSON.stringify(serviceSpec, null, 2)}\n`
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "generate",
        outdir: outputDir,
        files: [
          "adapter.generated.ts",
          "types.generated.ts",
          "service-spec.snapshot.json",
        ],
      },
      null,
      2
    )}\n`
  );
}

async function handleValidate(flags: Record<string, string | boolean>): Promise<void> {
  const specPath = requireString(flags.spec, "--spec is required");
  const mappingSpec = await loadMappingSpec(specPath);
  const cwd = dirname(resolve(specPath));
  const serviceSpec = await loadServiceSpecFromMapping(mappingSpec, cwd);
  const result = validateMappingSpec(mappingSpec, serviceSpec);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) {
    process.exitCode = 1;
  }
}

async function handleDrift(flags: Record<string, string | boolean>): Promise<void> {
  const specPath = requireString(flags.spec, "--spec is required");
  const baselinePath =
    readOptionalString(flags.baseline) ??
    resolve(dirname(resolve(specPath)), ".adapter-core", "service-spec.snapshot.json");
  const mappingSpec = await loadMappingSpec(specPath);
  const cwd = dirname(resolve(specPath));
  const current = await loadServiceSpecFromMapping(mappingSpec, cwd);
  const baseline = await loadSnapshot(baselinePath);
  const report = detectDrift(baseline, current);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.breaking.length > 0) {
    process.exitCode = 1;
  }
}

async function handleInit(flags: Record<string, string | boolean>): Promise<void> {
  const service = requireString(flags.service, "--service is required");
  const openapi = readOptionalString(flags.openapi);
  const postman = readOptionalString(flags.postman);
  const output = readOptionalString(flags.out) ?? `${service}.mapping.yaml`;
  const spec: MappingSpec = {
    adapter: {
      name: service,
      version: "1.0.0",
      source: {
        ...(openapi ? { openapi } : {}),
        ...(postman ? { postman } : {}),
      },
    },
    webhooks: {
      example: {
        path: `/${service}/events/{{id}}.json`,
      },
    },
    resources: {},
    writebacks: {},
  };

  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), YAML.stringify(spec));
  process.stdout.write(
    `${JSON.stringify({ command: "init", output: resolve(output) }, null, 2)}\n`
  );
}

async function handleDocsToSpec(
  flags: Record<string, string | boolean>
): Promise<void> {
  const url = requireString(flags.url, "--url is required");
  const out = requireString(flags.out, "--out is required");
  const docsSource = parseDocsSourceFlags(flags, url);
  const sync = parseSyncFlags(flags);
  const llm = parseLlmFlags(flags);
  const serviceName = readOptionalString(flags.service) ?? inferServiceName(url);
  const outputDir = resolve(out);

  const pages = await new DocsCrawler(docsSource).crawl();
  const extracted = await new APIExtractor(llm).extract(pages);
  const spec = new SpecGenerator().generate(extracted, {
    apiName: serviceName,
    docsSource,
    sync,
    llm,
  });
  const mapping = new MappingGenerator().generate(extracted, {
    serviceName,
    docsSource,
    sync,
    llm,
  });

  await mkdir(outputDir, { recursive: true });
  const specPath = resolve(outputDir, `${serviceName}.openapi.yaml`);
  const mappingPath = resolve(outputDir, `${serviceName}.mapping.yaml`);
  await writeFile(specPath, spec);
  await writeFile(mappingPath, mapping);

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "docs-to-spec",
        service: serviceName,
        spec: specPath,
        mapping: mappingPath,
        pages: pages.length,
        endpoints: extracted.endpoints.length,
        webhooks: extracted.webhooks.length,
      },
      null,
      2
    )}\n`
  );
}

async function handleDocsUpdate(
  flags: Record<string, string | boolean>
): Promise<void> {
  const specPath = requireString(flags.spec, "--spec is required");
  const specLocation = resolve(specPath);
  const existingSpec = await readFile(specLocation, "utf8");
  const document = asRecord(YAML.parse(existingSpec), "OpenAPI document");
  const metadata = readDocsMetadata(document);
  const detector = new ChangeDetector();
  const syncConfig = defaultSyncConfig(metadata.url, metadata.sync);
  const detectorResult =
    flags.force === true ? undefined : await detector.check(syncConfig);

  if (detectorResult && !detectorResult.changed) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: "docs-update",
          changed: false,
          reason: detectorResult.reason,
          spec: specLocation,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const pages = await new DocsCrawler({
    url: metadata.url,
    crawlPaths: metadata.crawlPaths,
    selectors: metadata.selectors,
  }).crawl();
  const extracted = await new APIExtractor(metadata.llm).extract(pages);
  const info = asLooseRecord(document.info);
  const updater = new SpecUpdater();
  const result = updater.update({
    existingSpec,
    extracted,
    apiName:
      typeof info?.title === "string"
        ? info.title
        : inferServiceName(metadata.url),
    apiVersion:
      typeof info?.version === "string" ? info.version : "1.0.0",
    docsSource: {
      url: metadata.url,
      crawlPaths: metadata.crawlPaths,
      selectors: metadata.selectors,
    },
    sync: metadata.sync,
    llm: metadata.llm,
    serviceNameForMapping:
      readOptionalString(flags.service) ?? inferServiceName(metadata.url),
  });

  await writeFile(specLocation, result.spec);
  const mappingLocation =
    readOptionalString(flags.mapping) ?? inferMappingPath(specLocation);
  if (result.mapping) {
    await writeFile(resolve(mappingLocation), result.mapping);
  }

  if (detectorResult) {
    await detector.record(syncConfig, detectorResult);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "docs-update",
        changed: result.changed,
        spec: specLocation,
        mapping: resolve(mappingLocation),
        warnings: result.warnings,
        changes: result.changes,
      },
      null,
      2
    )}\n`
  );
}

async function handleDocsCheck(
  flags: Record<string, string | boolean>
): Promise<void> {
  const specPath = requireString(flags.spec, "--spec is required");
  const existingSpec = await readFile(resolve(specPath), "utf8");
  const document = asRecord(YAML.parse(existingSpec), "OpenAPI document");
  const metadata = readDocsMetadata(document);
  const detector = new ChangeDetector();
  const config = defaultSyncConfig(metadata.url, metadata.sync);
  const result = await detector.check(config);
  await detector.record(config, result);
  process.stdout.write(
    `${JSON.stringify({ command: "docs-check", ...result }, null, 2)}\n`
  );
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const output: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      output[key] = true;
      continue;
    }
    output[key] = next;
    index += 1;
  }

  return output;
}

async function loadSnapshot(location: string): Promise<ServiceSpec> {
  const text = await readFile(resolve(location), "utf8");
  return JSON.parse(text) as ServiceSpec;
}

function requireString(value: string | boolean | undefined, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function readOptionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function renderValidation(
  issues: Array<{ level: string; path: string; message: string }>
): string {
  return issues
    .map((issue) => `${issue.level.toUpperCase()}: ${issue.path}: ${issue.message}`)
    .join("\n");
}

function printHelp(): void {
  process.stdout.write(`adapter-core

Commands:
  generate --spec <mapping> --outdir <dir>
  validate --spec <mapping>
  drift --spec <mapping> [--baseline <snapshot>]
  init --service <name> (--openapi <url> | --postman <url>) [--out <file>]
  docs-to-spec --url <docs-url> --out <dir> [--service <name>] [--paths <a,b>]
  docs-update --spec <openapi.yaml> [--mapping <mapping.yaml>] [--force]
  docs-check --spec <openapi.yaml>
`);
}

function parseDocsSourceFlags(
  flags: Record<string, string | boolean>,
  url: string
): DocsSourceConfig {
  return {
    url,
    crawlPaths: parseCsv(flags.paths),
    selectors: {
      content: readOptionalString(flags["content-selector"]),
      codeBlock: readOptionalString(flags["code-selector"]),
    },
  };
}

function parseSyncFlags(
  flags: Record<string, string | boolean>
): DocsSyncConfig | undefined {
  const trigger = readOptionalString(flags["sync-trigger"]);
  if (!trigger) {
    return undefined;
  }
  if (
    trigger !== "content-hash" &&
    trigger !== "changelog-rss" &&
    trigger !== "github-release"
  ) {
    throw new Error("--sync-trigger must be content-hash, changelog-rss, or github-release");
  }
  return {
    trigger,
    feedUrl: readOptionalString(flags["feed-url"]),
    repo: readOptionalString(flags.repo),
    stateFile: readOptionalString(flags["state-file"]),
  };
}

function parseLlmFlags(
  flags: Record<string, string | boolean>
): DocsLlmConfig | undefined {
  const hasLlmFlag = [
    flags["llm-provider"],
    flags["llm-endpoint"],
    flags["llm-model"],
    flags["llm-max-tokens"],
    flags["llm-concurrency"],
    flags["llm-chunk-size"],
  ].some((value) => value !== undefined);

  if (!hasLlmFlag) {
    return undefined;
  }

  const provider = readOptionalString(flags["llm-provider"]);
  return {
    provider:
      provider === "anthropic" || provider === "custom" || provider === "openai"
        ? provider
        : undefined,
    endpoint: readOptionalString(flags["llm-endpoint"]),
    model: readOptionalString(flags["llm-model"]),
    maxTokens: readOptionalNumber(flags["llm-max-tokens"]),
    concurrency: readOptionalNumber(flags["llm-concurrency"]),
    chunkSize: readOptionalNumber(flags["llm-chunk-size"]),
  };
}

function parseCsv(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readOptionalNumber(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferServiceName(url: string): string {
  const parsed = new URL(url);
  const parts = [parsed.hostname.replace(/^www\./, ""), parsed.pathname]
    .join(" ")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return parts[0]?.toLowerCase() ?? "docs-api";
}

function inferMappingPath(specPath: string): string {
  if (/\.openapi\.ya?ml$/i.test(specPath)) {
    return specPath.replace(/\.openapi\.ya?ml$/i, ".mapping.yaml");
  }
  if (/\.ya?ml$/i.test(specPath)) {
    return specPath.replace(/\.ya?ml$/i, ".mapping.yaml");
  }
  return `${specPath}.mapping.yaml`;
}

function readDocsMetadata(document: Record<string, unknown>): DocsSpecMetadata {
  const metadata = asRecord(document["x-docs-source"], "x-docs-source");
  const sync = asLooseRecord(metadata.sync);
  const llm = asLooseRecord(metadata.llm);
  const selectors = asLooseRecord(metadata.selectors);

  return {
    url: requireField(metadata.url, "x-docs-source.url"),
    crawlPaths: Array.isArray(metadata.crawlPaths)
      ? metadata.crawlPaths.filter((item): item is string => typeof item === "string")
      : undefined,
    selectors: selectors
      ? {
          content: typeof selectors.content === "string" ? selectors.content : undefined,
          codeBlock:
            typeof selectors.codeBlock === "string" ? selectors.codeBlock : undefined,
          pagination:
            typeof selectors.pagination === "string" ? selectors.pagination : undefined,
        }
      : undefined,
    sync: sync
      ? {
          trigger: requireField(sync.trigger, "x-docs-source.sync.trigger") as DocsSyncConfig["trigger"],
          feedUrl: typeof sync.feedUrl === "string" ? sync.feedUrl : undefined,
          repo: typeof sync.repo === "string" ? sync.repo : undefined,
        }
      : undefined,
    llm: llm
      ? {
          provider:
            llm.provider === "anthropic" ||
            llm.provider === "custom" ||
            llm.provider === "openai"
              ? (llm.provider as DocsLlmConfig["provider"])
              : undefined,
          endpoint: typeof llm.endpoint === "string" ? llm.endpoint : undefined,
          model: typeof llm.model === "string" ? llm.model : undefined,
          maxTokens: typeof llm.maxTokens === "number" ? llm.maxTokens : undefined,
          concurrency: typeof llm.concurrency === "number" ? llm.concurrency : undefined,
          chunkSize: typeof llm.chunkSize === "number" ? llm.chunkSize : undefined,
        }
      : undefined,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asLooseRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
