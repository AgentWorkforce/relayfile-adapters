import YAML from "yaml";
import { SpecGenerator, type SpecGeneratorOptions } from "./generator.js";
import { MappingGenerator } from "./mapping-generator.js";
import type { Change, ExtractedAPI, UpdateResult } from "./types.js";

export interface SpecUpdaterOptions extends SpecGeneratorOptions {
  existingSpec: string;
  extracted: ExtractedAPI;
  serviceNameForMapping?: string;
}

export class SpecUpdater {
  update(options: SpecUpdaterOptions): UpdateResult {
    const existing = asRecord(YAML.parse(options.existingSpec));
    const next = new SpecGenerator().generateDocument(options.extracted, options);
    const changes: Change[] = [];
    const warnings: string[] = [];
    const merged = structuredClone(existing);

    merged.openapi = next.openapi;
    merged.info = mergeNode(existing.info, next.info, "info", changes, warnings);
    merged.components = mergeComponents(
      asRecord(existing.components) ?? {},
      asRecord(next.components) ?? {},
      changes,
      warnings
    );
    merged["x-docs-source"] = next["x-docs-source"];
    merged["x-webhooks"] = mergeMapSection(
      asRecord(existing["x-webhooks"]) ?? {},
      asRecord(next["x-webhooks"]) ?? {},
      "x-webhooks",
      changes,
      warnings
    );
    merged.paths = mergePaths(
      asRecord(existing.paths) ?? {},
      asRecord(next.paths) ?? {},
      changes,
      warnings
    );

    const mapping = new MappingGenerator().generate(options.extracted, {
      serviceName:
        options.serviceNameForMapping ??
        options.apiName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      docsSource: options.docsSource,
      sync: options.sync,
      llm: options.llm,
    });

    return {
      changed: changes.length > 0,
      changes,
      spec: YAML.stringify(merged, { lineWidth: 0 }),
      mapping,
      warnings,
    };
  }
}

function mergeComponents(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
  changes: Change[],
  warnings: string[]
): Record<string, unknown> {
  return {
    ...existing,
    securitySchemes: mergeMapSection(
      asRecord(existing.securitySchemes) ?? {},
      asRecord(next.securitySchemes) ?? {},
      "components.securitySchemes",
      changes,
      warnings
    ),
    schemas: mergeMapSection(
      asRecord(existing.schemas) ?? {},
      asRecord(next.schemas) ?? {},
      "components.schemas",
      changes,
      warnings
    ),
  };
}

function mergePaths(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
  changes: Change[],
  warnings: string[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  const methods = ["delete", "get", "patch", "post", "put"];

  for (const [path, nextItem] of Object.entries(next)) {
    const existingItem = asRecord(existing[path]) ?? {};
    const nextRecord = asRecord(nextItem) ?? {};
    const mergedItem: Record<string, unknown> = { ...existingItem };

    for (const method of methods) {
      const nextOperation = nextRecord[method];
      if (!nextOperation) {
        continue;
      }
      const label = `paths.${path}.${method}`;
      if (!(method in existingItem)) {
        mergedItem[method] = nextOperation;
        changes.push({
          type: "added",
          path: label,
          detail: "Added new operation from docs",
        });
        continue;
      }
      mergedItem[method] = mergeNode(
        existingItem[method],
        nextOperation,
        label,
        changes,
        warnings
      );
    }

    for (const method of methods) {
      if (!(method in nextRecord) && method in existingItem) {
        const operation = asRecord(existingItem[method]) ?? {};
        if (isHumanEdited(operation)) {
          warnings.push(`${path} ${method} removed from docs but preserved because it is marked x-human-edited`);
          continue;
        }
        if (operation.deprecated !== true) {
          mergedItem[method] = { ...operation, deprecated: true };
          changes.push({
            type: "deprecated",
            path: `paths.${path}.${method}`,
            detail: "Operation no longer present in docs; marked deprecated",
          });
        }
      }
    }

    merged[path] = mergedItem;
  }

  for (const [path, existingItem] of Object.entries(existing)) {
    if (!(path in merged)) {
      merged[path] = existingItem;
    }
  }

  return merged;
}

function mergeMapSection(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
  section: string,
  changes: Change[],
  warnings: string[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(next)) {
    const path = `${section}.${key}`;
    if (!(key in existing)) {
      merged[key] = value;
      changes.push({ type: "added", path, detail: "Added from docs" });
      continue;
    }
    merged[key] = mergeNode(existing[key], value, path, changes, warnings);
  }

  return merged;
}

function mergeNode(
  existing: unknown,
  next: unknown,
  path: string,
  changes: Change[],
  warnings: string[]
): unknown {
  if (isHumanEdited(existing)) {
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      warnings.push(`${path} differs from docs but was preserved because it is marked x-human-edited`);
      changes.push({
        type: "preserved",
        path,
        detail: "Preserved x-human-edited section",
      });
    }
    return existing;
  }

  if (JSON.stringify(existing) !== JSON.stringify(next)) {
    changes.push({
      type: "modified",
      path,
      detail: "Updated from docs",
    });
  }

  return next;
}

function isHumanEdited(value: unknown): boolean {
  const record = asRecord(value);
  return record?.["x-human-edited"] === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
