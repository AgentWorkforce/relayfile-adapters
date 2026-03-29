const TEMPLATE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractTemplateFields(template: string): string[] {
  const fields = new Set<string>();
  let match: RegExpExecArray | null;

  for (;;) {
    match = TEMPLATE_PATTERN.exec(template);
    if (!match) {
      break;
    }
    fields.add(match[1].trim());
  }

  TEMPLATE_PATTERN.lastIndex = 0;
  return [...fields];
}

export function readTemplateValue(
  input: unknown,
  path: string
): unknown {
  const segments = path.split(".").filter(Boolean);
  let cursor: unknown = input;

  for (const segment of segments) {
    if (Array.isArray(cursor)) {
      const index = Number.parseInt(segment, 10);
      cursor = Number.isNaN(index) ? undefined : cursor[index];
      continue;
    }
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }

  return cursor;
}

export function interpolateTemplate(
  template: string,
  input: unknown,
  options: { strict?: boolean } = {}
): string {
  return template.replace(TEMPLATE_PATTERN, (_match, rawField: string) => {
    const field = rawField.trim();
    const value = readTemplateValue(input, field);
    if (value === undefined || value === null) {
      if (options.strict) {
        throw new Error(`Missing template value for "${field}" in "${template}"`);
      }
      return "";
    }
    return encodeTemplateValue(value);
  });
}

export function pickFields(
  input: Record<string, unknown>,
  fields?: string[]
): Record<string, unknown> {
  if (!fields || fields.length === 0) {
    return input;
  }

  const output: Record<string, unknown> = {};

  for (const field of fields) {
    const value = readTemplateValue(input, field);
    if (value !== undefined) {
      output[field] = value;
    }
  }

  return output;
}

export function pathExists(
  input: unknown,
  path: string
): boolean {
  return readTemplateValue(input, path) !== undefined;
}

function encodeTemplateValue(value: unknown): string {
  if (typeof value === "string") {
    return encodeURIComponent(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeTemplateValue(item)).join("/");
  }
  return encodeURIComponent(JSON.stringify(value));
}
