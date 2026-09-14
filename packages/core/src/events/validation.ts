import { KNOWN_TRIGGER_CATALOG, type KnownProviderName } from "../triggers/catalog.generated.js";
import type { EventJson } from "./types.js";

export function record(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${at} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${at} must contain only JSON data properties`);
    }
  }
  return value as Record<string, unknown>;
}

export function knownKeys(value: Record<string, unknown>, keys: readonly string[], at: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${at}.${key} is not supported`);
  }
}

export function text(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${at} must be a nonempty string without surrounding whitespace`);
  }
  return value;
}

export function provider(value: unknown): KnownProviderName {
  const name = text(value, "provider");
  if (!Object.hasOwn(KNOWN_TRIGGER_CATALOG, name)) throw new TypeError(`Unknown event provider: ${name}`);
  return name as KnownProviderName;
}

export function eventType(value: unknown, name: KnownProviderName): string {
  const type = text(value, "eventType");
  if (!(KNOWN_TRIGGER_CATALOG[name] as readonly string[]).includes(type)) {
    throw new TypeError(`Unknown ${name} event type: ${type}`);
  }
  return type;
}

export function path(value: unknown, at: string): string {
  const result = text(value, at);
  if (!result.startsWith("/") || result.includes("\\") || /[\u0000-\u001f\u007f*?\[\]{}]/u.test(result)
      || (result !== "/" && result.split("/").slice(1).some(part => !part || part === "." || part === ".."))) {
    throw new TypeError(`${at} must be a concrete absolute Relayfile path without traversal or globs`);
  }
  return result;
}

export function list(value: unknown, at: string, item: (value: unknown, at: string) => string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${at} must be a nonempty array`);
  arrayProperties(value);
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) result.push(item(value[i], `${at}[${i}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${at} must not contain duplicates`);
  return Object.freeze(result);
}

function arrayProperties(value: unknown[]): void {
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length
        || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("arrays must contain only JSON data elements");
    }
  }
}

export function timestamp(value: unknown): string {
  const result = text(value, "occurredAt");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result)
      || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    throw new TypeError("occurredAt must be a canonical UTC ISO timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)");
  }
  return result;
}

export function json(value: unknown, seen = new Set<object>()): EventJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || seen.has(value)) throw new TypeError("payload must be finite, acyclic JSON data");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      arrayProperties(value);
      const items: EventJson[] = [];
      for (let i = 0; i < value.length; i++) items.push(json(value[i], seen));
      return Object.freeze(items);
    }
    return Object.freeze(Object.fromEntries(Object.entries(record(value, "payload"))
      .map(([key, item]) => [key, json(item, seen)])));
  } finally {
    seen.delete(value);
  }
}
