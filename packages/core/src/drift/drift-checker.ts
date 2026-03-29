import type { SchemaNode, ServiceSpec } from "../ingest/types.js";

export interface DriftItem {
  type: string;
  path: string;
  message: string;
}

export interface DriftReport {
  breaking: DriftItem[];
  warnings: DriftItem[];
  additions: DriftItem[];
}

export function detectDrift(
  baseline: ServiceSpec,
  current: ServiceSpec
): DriftReport {
  const report: DriftReport = {
    breaking: [],
    warnings: [],
    additions: [],
  };

  compareEndpoints(baseline, current, report);
  compareSchemas("components", baseline.schemas, current.schemas, report, current);
  compareSchemas("webhooks", baseline.webhookSchemas, current.webhookSchemas, report, current);

  return report;
}

function compareEndpoints(
  baseline: ServiceSpec,
  current: ServiceSpec,
  report: DriftReport
): void {
  const currentByKey = new Map(current.endpoints.map((endpoint) => [endpoint.key, endpoint]));

  for (const endpoint of baseline.endpoints) {
    const next = currentByKey.get(endpoint.key);
    if (!next) {
      report.breaking.push({
        type: "endpoint_removed",
        path: endpoint.key,
        message: `Endpoint ${endpoint.key} was removed`,
      });
      continue;
    }

    const baselineParameters = new Map(
      endpoint.parameters.map((parameter) => [parameter.name, parameter])
    );
    const nextParameters = new Map(
      next.parameters.map((parameter) => [parameter.name, parameter])
    );

    for (const [name, parameter] of baselineParameters) {
      const nextParameter = nextParameters.get(name);
      if (!nextParameter) {
        report.breaking.push({
          type: "parameter_removed",
          path: `${endpoint.key}#${name}`,
          message: `Parameter ${name} was removed`,
        });
      } else if ((parameter.schema?.type ?? "unknown") !== (nextParameter.schema?.type ?? "unknown")) {
        report.breaking.push({
          type: "parameter_type_changed",
          path: `${endpoint.key}#${name}`,
          message: `Parameter ${name} changed type from ${parameter.schema?.type ?? "unknown"} to ${nextParameter.schema?.type ?? "unknown"}`,
        });
      }
    }

    for (const [name, parameter] of nextParameters) {
      if (!baselineParameters.has(name)) {
        report.additions.push({
          type: parameter.required ? "required_parameter_added" : "parameter_added",
          path: `${endpoint.key}#${name}`,
          message: `Parameter ${name} was added`,
        });
      }
    }
  }

  const baselineKeys = new Set(baseline.endpoints.map((endpoint) => endpoint.key));
  for (const endpoint of current.endpoints) {
    if (!baselineKeys.has(endpoint.key)) {
      report.additions.push({
        type: "endpoint_added",
        path: endpoint.key,
        message: `Endpoint ${endpoint.key} was added`,
      });
    }
  }
}

function compareSchemas(
  group: string,
  baselineSchemas: Record<string, SchemaNode>,
  currentSchemas: Record<string, SchemaNode>,
  report: DriftReport,
  currentSpec: ServiceSpec
): void {
  for (const [name, schema] of Object.entries(baselineSchemas)) {
    const next = currentSchemas[name];
    if (!next) {
      report.breaking.push({
        type: "schema_removed",
        path: `${group}.${name}`,
        message: `Schema ${name} was removed`,
      });
      continue;
    }

    const baselineFields = flattenSchema(schema, currentSpec, name);
    const currentFields = flattenSchema(next, currentSpec, name);
    const parentAdds = new Map<string, string[]>();
    const parentRemovals = new Map<string, string[]>();

    for (const [path, descriptor] of baselineFields) {
      const nextDescriptor = currentFields.get(path);
      if (!nextDescriptor) {
        report.breaking.push({
          type: "field_removed",
          path: `${group}.${name}.${path}`,
          message: `Field ${path} was removed`,
        });
        pushGrouped(parentRemovals, parentPath(path), path);
        continue;
      }

      if (descriptor.type !== nextDescriptor.type) {
        report.breaking.push({
          type: "field_type_changed",
          path: `${group}.${name}.${path}`,
          message: `Field ${path} changed type from ${descriptor.type} to ${nextDescriptor.type}`,
        });
      }
    }

    for (const [path, descriptor] of currentFields) {
      if (!baselineFields.has(path)) {
        const bucket = descriptor.required ? report.breaking : report.additions;
        bucket.push({
          type: descriptor.required ? "required_field_added" : "field_added",
          path: `${group}.${name}.${path}`,
          message: `Field ${path} was added`,
        });
        pushGrouped(parentAdds, parentPath(path), path);
      }
    }

    for (const [parent, removed] of parentRemovals) {
      const added = parentAdds.get(parent);
      if (!added) {
        continue;
      }
      for (const removedPath of removed) {
        const removedType = baselineFields.get(removedPath)?.type;
        const similar = added.find((addedPath) => currentFields.get(addedPath)?.type === removedType);
        if (similar) {
          report.warnings.push({
            type: "possible_rename",
            path: `${group}.${name}.${parent}`,
            message: `Possible rename detected: ${removedPath} -> ${similar}`,
          });
        }
      }
    }
  }

  for (const name of Object.keys(currentSchemas)) {
    if (!(name in baselineSchemas)) {
      report.additions.push({
        type: "schema_added",
        path: `${group}.${name}`,
        message: `Schema ${name} was added`,
      });
    }
  }
}

function flattenSchema(
  schema: SchemaNode,
  serviceSpec: ServiceSpec,
  name: string,
  prefix = "",
  seen = new Set<string>()
): Map<string, { type: string; required: boolean }> {
  const output = new Map<string, { type: string; required: boolean }>();
  const node = dereference(schema, serviceSpec, seen);
  const properties = node.properties ?? {};
  const required = new Set(node.required ?? []);

  for (const [key, value] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const resolved = dereference(value, serviceSpec, seen);
    output.set(path, {
      type: describeType(resolved),
      required: required.has(key),
    });
    for (const [childPath, childValue] of flattenSchema(
      resolved,
      serviceSpec,
      name,
      path,
      seen
    )) {
      output.set(childPath, childValue);
    }
  }

  if (node.items) {
    const itemPath = prefix ? `${prefix}[]` : `${name}[]`;
    output.set(itemPath, {
      type: describeType(node.items),
      required: true,
    });
    for (const [childPath, childValue] of flattenSchema(
      node.items,
      serviceSpec,
      name,
      itemPath,
      seen
    )) {
      output.set(childPath, childValue);
    }
  }

  return output;
}

function dereference(
  schema: SchemaNode,
  serviceSpec: ServiceSpec,
  seen: Set<string>
): SchemaNode {
  if (!schema.ref) {
    return schema;
  }

  const refName = schema.ref.replace(/^#\/components\/schemas\//, "");
  if (seen.has(refName)) {
    return schema;
  }
  seen.add(refName);
  return serviceSpec.schemas[refName] ?? schema;
}

function describeType(schema: SchemaNode): string {
  if (schema.ref) {
    return `ref:${schema.ref}`;
  }
  if (schema.oneOf?.length) {
    return schema.oneOf.map(describeType).join("|");
  }
  if (schema.anyOf?.length) {
    return schema.anyOf.map(describeType).join("|");
  }
  if (schema.allOf?.length) {
    return schema.allOf.map(describeType).join("&");
  }
  return schema.type ?? "unknown";
}

function parentPath(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(0, index);
}

function pushGrouped(store: Map<string, string[]>, key: string, value: string): void {
  const current = store.get(key) ?? [];
  current.push(value);
  store.set(key, current);
}
