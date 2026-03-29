import { fileURLToPath } from "node:url";
import { SchemaAdapter, loadMappingSpec } from "../../dist/src/index.js";

const mappingPath = fileURLToPath(new URL("./resend.mapping.yaml", import.meta.url));
const spec = await loadMappingSpec(mappingPath);
const [resourceName, resourceMapping] = Object.entries(spec.resources ?? {})[0] ?? [];

if (!resourceName || !resourceMapping) {
  throw new Error("Generated mapping does not contain any resources");
}

const input = Object.fromEntries(
  Array.from(resourceMapping.path.matchAll(/\{\{([^}]+)\}\}/g)).map((match) => [
    match[1],
    match[1].includes("id") ? `${match[1]}_demo` : "demo",
  ])
);

const adapter = new SchemaAdapter({
  client: {
    async ingestWebhook() {
      return { status: "queued", id: "q_demo" };
    },
  },
  provider: {
    name: "resend",
    async proxy() {
      return { status: 200, headers: {}, data: { ok: true } };
    },
    async healthCheck() {
      return true;
    },
  },
  spec,
});

const computedPath = adapter.computeResourcePath(resourceName, input);

process.stdout.write(
  `${JSON.stringify(
    {
      adapter: adapter.name,
      version: adapter.version,
      mappingPath,
      resourceName,
      computedPath,
    },
    null,
    2
  )}\n`
);
