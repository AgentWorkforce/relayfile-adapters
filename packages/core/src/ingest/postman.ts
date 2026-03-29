import { convert } from "@scalar/postman-to-openapi";
import { openApiDocumentToServiceSpec } from "./openapi.js";
import { asRecord, parseStructuredText, readSourceText } from "./shared.js";
import type { ServiceSpec } from "./types.js";

export async function loadPostmanSpec(
  location: string,
  cwd = process.cwd()
): Promise<ServiceSpec> {
  const text = await readSourceText(location, cwd);
  const parsed = parseStructuredText(text, location);
  const collection = asRecord(parsed, "Postman collection");
  const document = asRecord(convert(collection as any), "Converted OpenAPI document");

  return openApiDocumentToServiceSpec(document, {
    sourceKind: "postman",
    sourceLocation: location,
  });
}
