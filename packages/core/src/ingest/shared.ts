import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export async function readSourceText(
  location: string,
  cwd = process.cwd()
): Promise<string> {
  if (isHttpUrl(location)) {
    const response = await fetch(location);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${location}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  return readFile(resolve(cwd, location), "utf8");
}

export function parseStructuredText(
  text: string,
  location = "<inline>"
): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    try {
      return YAML.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse ${location}: ${message}`);
    }
  }
}

export function asRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function firstJsonContent(
  content: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!content) {
    return undefined;
  }

  const preferred = content["application/json"];
  if (preferred && typeof preferred === "object" && preferred !== null) {
    return preferred as Record<string, unknown>;
  }

  for (const value of Object.values(content)) {
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
  }

  return undefined;
}
