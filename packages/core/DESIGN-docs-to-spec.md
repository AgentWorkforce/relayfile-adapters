# docs-to-spec: Design Document

Bootstrap adapters from documentation pages when no OpenAPI/Postman spec exists.

## Architecture

```
URL ─► DocsCrawler ─► DocPage[] ─► APIExtractor (LLM) ─► ExtractedAPI ─► SpecGenerator ─► OpenAPI YAML
                                                                         └─► MappingGenerator ─► mapping YAML
```

Once generated, specs feed into existing adapter-core pipeline (spec loaders, SchemaAdapter, drift).

## File Tree

```
src/docs/
├── crawler.ts          # Fetch + extract doc pages (cheerio)
├── extractor.ts        # LLM-based API structure extraction
├── generator.ts        # ExtractedAPI → OpenAPI 3.0 YAML
├── updater.ts          # Diff-based spec updates on re-crawl
├── mapping-generator.ts # ExtractedAPI → mapping YAML
├── change-detector.ts  # Cheap pre-crawl change detection
└── types.ts            # DocPage, ExtractedAPI, etc.
```

## Types (src/docs/types.ts)

```typescript
export interface DocPage { url: string; title: string; content: string; }
export interface ExtractedEndpoint { method: string; path: string; params: Param[]; responseShape: Record<string, unknown>; }
export interface ExtractedWebhook { event: string; payloadShape: Record<string, unknown>; deliveryFormat?: string; }
export interface ExtractedAuth { type: 'bearer' | 'api-key' | 'oauth2'; headerName?: string; }
export interface ExtractedAPI { endpoints: ExtractedEndpoint[]; webhooks: ExtractedWebhook[]; auth?: ExtractedAuth; rateLimits?: string; errorShape?: Record<string, unknown>; }
export interface Param { name: string; in: 'path' | 'query' | 'header' | 'body'; type: string; required: boolean; }
export interface UpdateResult { changes: Change[]; spec: string; }
export interface Change { type: 'added' | 'removed' | 'modified'; path: string; detail: string; }
export interface ChangeDetectionResult { changed: boolean; reason?: string; previousHash?: string; currentHash?: string; }
```

## Component Contracts

### 1. DocsCrawler (crawler.ts)
- **Input:** `{ baseUrl: string; crawlPaths?: string[]; selectors?: { content?: string; codeBlock?: string } }`
- **Deps:** `fetch` (native), `cheerio` (HTML→text)
- Respects robots.txt (fetch + parse), rate-limits (100ms between requests)
- Strips nav/footer/sidebar via default selectors (overridable)
- Follows "next page" pagination links within crawlPaths scope
- **Output:** `DocPage[]`

### 2. APIExtractor (extractor.ts)
- **Input:** `DocPage[]`, LLM config `{ model?: string; maxTokens?: number }`
- Chunks pages to fit context window (~8k tokens/chunk)
- Sends structured extraction prompt with JSON schema for output
- Processes chunks in parallel (configurable concurrency)
- Deduplicates endpoints by `method+path`, merges parameter info
- **Output:** `ExtractedAPI`
- **LLM provider:** Uses adapter-core's configured provider (env: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)

### 3. SpecGenerator (generator.ts)
- **Input:** `ExtractedAPI`, `{ apiName: string; apiDescription?: string }`
- Generates OpenAPI 3.0 YAML: info, paths, components/schemas, securitySchemes
- Webhooks → `x-webhooks` extension (OpenAPI 3.1 compatible)
- Validates output structure before returning
- **Output:** `string` (YAML)

### 4. SpecUpdater (updater.ts)
- **Input:** `{ existingSpec: string; newExtraction: ExtractedAPI }`
- Diffs existing spec paths/schemas against new extraction
- New endpoints → add; removed → mark `deprecated: true` (never delete)
- Preserves sections with `x-human-edited: true`
- Flags conflicting human-edited sections as warnings
- **Output:** `UpdateResult`

### 5. MappingGenerator (mapping-generator.ts)
- **Input:** `ExtractedAPI`, `{ serviceName: string }`
- Infers VFS paths: `/{service}/{resource}/{id}/metadata.json` for REST, `/{service}/events/{type}/{id}.json` for webhooks
- **Output:** `string` (mapping YAML)

### 6. ChangeDetector (change-detector.ts)
- **Input:** `{ trigger: 'content-hash' | 'changelog-rss' | 'github-release'; url: string; feedUrl?: string; repo?: string }`
- `content-hash`: HEAD/GET page, SHA-256 content, compare to `.adapter-core-state.json`
- `changelog-rss`: fetch RSS/Atom feed, check for entries newer than last check
- `github-release`: GitHub API, compare latest tag to stored tag
- State stored in `.adapter-core-state.json` (gitignored)
- **Output:** `ChangeDetectionResult` — cost: 1 HTTP request, zero LLM tokens

## CLI Commands (additions to src/cli.ts)

```
npx adapter-core docs-to-spec --url <docs-url> [--paths /api,/webhooks] --out ./specs/
  → One-shot: crawl → extract → generate spec + mapping YAML

npx adapter-core docs-update --spec ./specs/example.yaml
  → Re-crawl, diff, apply only changes (preserves human edits)

npx adapter-core docs-check --spec ./specs/example.yaml
  → Cheap change detection only (no LLM, hash check)
```

No `docs-watch` or scheduled mode. Always opt-in.

## Mapping YAML Extension

```yaml
adapter:
  name: example-api
  source:
    docs:
      url: https://docs.example.com/api-reference
      crawl_paths: [/api-reference/endpoints, /api-reference/webhooks]
      selectors: { content: ".api-content", code_block: "pre code" }
    sync:                           # optional, opt-in
      trigger: content-hash         # or: changelog-rss, github-release
    llm: { model: claude-sonnet, max_tokens: 4096 }
```

`source.docs` is a new alternative to `source.openapi` / `source.postman`.

## CI Workflow (.github/workflows/docs-check.yml)

- **Trigger:** `workflow_dispatch` (manual) + optional cron (adapter owner adds)
- Only runs if `sync.trigger` configured in mapping YAML
- Step 1: `docs-check` (cheap hash/rss/release check) → exit 0 if unchanged
- Step 2: If changed → `docs-update` → open PR with spec diff
- Zero cost when docs haven't changed

## Dependencies (additions to package.json)

```json
"cheerio": "^1.0.0"   // HTML parsing + content extraction
```

LLM calls use native `fetch` against provider APIs — no SDK dependency in core.

## Extraction Prompt Pattern

```
Given the following API documentation, extract all API endpoints, webhooks,
authentication methods, and error formats. Return as JSON matching this schema:
{ endpoints: [...], webhooks: [...], auth: {...}, errorShape: {...} }

Documentation chunk:
---
{chunk_content}
---
```

Chunks processed in parallel, results merged with dedup on `method+path`.

DESIGN_COMPLETE
