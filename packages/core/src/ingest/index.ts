import { DocsCrawler } from "../docs/crawler.js";
import { APIExtractor } from "../docs/extractor.js";
import { SpecGenerator } from "../docs/generator.js";
import type { MappingSpec } from "../spec/types.js";
import {
  loadOpenApiSpec,
  openApiDocumentToServiceSpec,
} from "./openapi.js";
import { loadPostmanSpec } from "./postman.js";
import { loadSampleSpec } from "./sample.js";
import type { ServiceSpec } from "./types.js";

export async function loadServiceSpecFromMapping(
  spec: MappingSpec,
  cwd = process.cwd()
): Promise<ServiceSpec> {
  if (spec.adapter.source.openapi) {
    return loadOpenApiSpec(spec.adapter.source.openapi, cwd);
  }
  if (spec.adapter.source.postman) {
    return loadPostmanSpec(spec.adapter.source.postman, cwd);
  }
  if (spec.adapter.source.samples) {
    return loadSampleSpec(spec.adapter.source.samples, cwd);
  }
  if (spec.adapter.source.docs) {
    const pages = await new DocsCrawler(spec.adapter.source.docs).crawl();
    const extracted = await new APIExtractor(spec.adapter.source.llm).extract(pages);
    const document = new SpecGenerator().generateDocument(extracted, {
      apiName: spec.adapter.name,
      apiVersion: spec.adapter.version,
      docsSource: spec.adapter.source.docs,
      sync: spec.adapter.source.sync,
      llm: spec.adapter.source.llm,
    });
    return openApiDocumentToServiceSpec(document, {
      sourceKind: "docs",
      sourceLocation: spec.adapter.source.docs.url,
    });
  }

  throw new Error("Mapping spec does not define a supported source");
}
