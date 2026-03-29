/**
 * 058-docs-to-spec-agent.ts
 *
 * Build the docs-to-spec agent for @relayfile/adapter-core.
 *
 * For APIs that only have documentation (no OpenAPI/Postman spec), this
 * agent crawls the docs, extracts API structure, and generates an OpenAPI spec.
 *
 * It also handles ongoing maintenance:
 * - Scheduled re-crawls detect doc changes
 * - Diffs against previous spec to find additions/removals/changes
 * - Opens PRs in the adapter repo with updated specs
 *
 * This is the fourth input path for adapter-core:
 *   docs URL → agent crawl → generated OpenAPI → ServiceSpec → SchemaAdapter
 *
 * Run: agent-relay run workflows/058-docs-to-spec-agent.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const ROOT = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-core';

async function main() {
  const result = await workflow('docs-to-spec-agent')
    .description('Build docs-to-spec agent — crawl API docs, generate + maintain OpenAPI specs')
    .pattern('linear')
    .channel('wf-docs-to-spec')
    .maxConcurrency(2)
    .timeout(3_600_000)

    .agent('architect', { cli: 'claude', role: 'Designs the docs-to-spec pipeline' })
    .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements the crawler and generator' })
    .agent('reviewer', { cli: 'claude', role: 'Reviews the implementation' })

    .step('design', {
      agent: 'architect',
      task: `Design the docs-to-spec agent for adapter-core.

Read existing adapter-core context:
- ${ROOT}/workflows/057-adapter-core-scaffold.ts — the core design (spec loaders, generators, drift)

The problem: many APIs have NO published spec. Only documentation pages.
Examples: most webhook-first services, internal APIs, newer startups.

Design the docs-to-spec pipeline:

1. **DocsCrawler** (src/docs/crawler.ts):
   - Input: base URL + optional crawl paths
   - Fetches pages (plain HTTP for static docs, notes on SPA handling)
   - Extracts meaningful content (strips nav, footers, ads)
   - Handles pagination ("Next page" links in docs)
   - Respects robots.txt and rate limits
   - Outputs: array of DocPage { url, title, content (markdown) }
   - Use fetch + cheerio for HTML → text extraction (not a headless browser)

2. **APIExtractor** (src/docs/extractor.ts):
   - Input: array of DocPage
   - Uses LLM (via adapter-core's configured provider) to extract:
     a. Endpoints: method, path, params, response shape
     b. Authentication: type (bearer, api-key, oauth), header names
     c. Webhook events: event names, payload shapes, delivery format
     d. Rate limits: if documented
     e. Error formats: common error response shape
   - Uses structured output (JSON schema) to enforce consistent extraction
   - Chunks large docs and processes in parallel
   - Outputs: ExtractedAPI { endpoints[], webhooks[], auth, errors }
   
   Extraction prompt pattern:
   - Feed doc content in chunks
   - Ask for structured JSON output matching a schema
   - Merge results from multiple chunks
   - Deduplicate endpoints that appear in multiple doc pages

3. **SpecGenerator** (src/docs/generator.ts):
   - Input: ExtractedAPI
   - Generates valid OpenAPI 3.0 spec:
     a. Info section from API name/description
     b. Paths from extracted endpoints
     c. Components/schemas from response shapes
     d. Security schemes from auth info
     e. x-webhooks from webhook events (OpenAPI 3.1)
   - Validates output against OpenAPI spec schema
   - Outputs: YAML string (well-formatted, human-readable)

4. **SpecUpdater** (src/docs/updater.ts):
   - For subsequent runs (not first generation):
     a. Re-crawl docs
     b. Re-extract API structure
     c. Diff against existing spec
     d. Apply only changes (don't regenerate from scratch)
     e. Preserve human edits (marked with x-human-edited: true)
   - Outputs: UpdateResult { changes[], spec }
   
   Smart diffing:
   - New endpoint added → add to spec
   - Endpoint removed from docs → mark as deprecated (don't delete)
   - Parameter changed → update, flag for review
   - Human-edited sections → preserve, warn if docs conflict

5. **MappingGenerator** (src/docs/mapping-generator.ts):
   - After spec is generated, auto-generate the mapping YAML too
   - Uses the API structure to infer sensible VFS paths:
     a. REST resources → /\{service}/\{resource-type}/\{id}/metadata.json
     b. Webhooks → /\{service}/events/\{event-type}/\{id}.json
     c. Nested resources follow REST hierarchy
   - Outputs: mapping YAML string

6. **ChangeDetector** (src/docs/change-detector.ts):
   - Docs-to-spec is primarily a ONE-TIME bootstrap tool
   - Ongoing sync is OPT-IN only, never automatic by default
   - ChangeDetector does a cheap check BEFORE any crawl/LLM work:
     a. content-hash: HEAD request or fetch page, hash content, compare to stored hash
        If unchanged → skip entirely (cost: 1 HTTP request, zero LLM tokens)
        If changed → proceed to full crawl + extraction
     b. changelog-rss: subscribe to API's changelog RSS/Atom feed
        Only trigger when new feed entry appears
     c. github-release: watch API provider's docs repo for new tags/releases
        Trigger crawl when new version detected
   - Stores last-known hash in .adapter-core-state.json (gitignored)
   - Returns: { changed: boolean, reason?: string, previousHash?, currentHash? }

7. **CLI commands** (additions to src/cli.ts):
   - npx adapter-core docs-to-spec --url https://docs.example.com/api --out ./specs/
     (one-shot bootstrap: crawl → extract → generate spec + mapping)
   - npx adapter-core docs-update --spec ./specs/example.yaml
     (re-crawl, diff against existing, only update if docs changed)
   - npx adapter-core docs-check --spec ./specs/example.yaml
     (cheap change detection only — no LLM, just hash check)
   - NO "docs-watch" or scheduled mode — this is always opt-in

8. **Mapping YAML extension**:
   \`\`\`yaml
   adapter:
     name: example-api
     source:
       docs:
         url: https://docs.example.com/api-reference
         crawl_paths:           # optional: limit crawl to these paths
           - /api-reference/endpoints
           - /api-reference/webhooks
         selectors:             # optional: CSS selectors for content
           content: ".api-content"
           code_block: "pre code"
         # NO schedule by default — manual/opt-in only
         sync:                  # optional: enable change detection
           trigger: content-hash  # or: changelog-rss, github-release
           # feed_url: https://example.com/changelog.xml  (for changelog-rss)
           # repo: example/docs  (for github-release)
         llm:                   # optional: LLM config for extraction
           model: claude-sonnet  # default
           max_tokens: 4096
   \`\`\`

9. **CI workflow** (.github/workflows/docs-check.yml):
   - ONLY runs if adapter has sync.trigger configured (opt-in)
   - Does cheap change detection first (content-hash/rss/release)
   - If no change detected → exit 0, zero cost
   - If change detected → full crawl + extract → open PR with diff
   - Can run manually: workflow_dispatch with URL input
   - NOT scheduled by default — adapter owner adds cron if they want it

Output: architecture, file tree, CLI interface, extraction schema.
Keep under 100 lines. End with DESIGN_COMPLETE.`,
      verification: { type: 'output_contains', value: 'DESIGN_COMPLETE' },
      timeout: 300_000,
    })

    .step('implement', {
      agent: 'builder',
      dependsOn: ['design'],
      task: `Implement the docs-to-spec agent.

Design: {{steps.design.output}}

Working in ${ROOT} on branch feat/docs-to-spec.

1. Install deps:
   - cheerio (HTML parsing, lightweight)
   - No LLM SDK dep — use raw fetch to configurable endpoint

2. Implement:
   - src/docs/crawler.ts — DocsCrawler class
     - fetch pages, extract content via cheerio
     - handle relative links, pagination
     - rate limit (1 req/sec default)
   
   - src/docs/extractor.ts — APIExtractor class
     - Configurable LLM endpoint (default: Anthropic API)
     - Structured extraction prompts with JSON schema enforcement
     - Chunk large docs, process in parallel, merge results
     - ExtractedAPI type: { endpoints, webhooks, auth, errors }
   
   - src/docs/generator.ts — SpecGenerator class
     - ExtractedAPI → valid OpenAPI 3.0 YAML
     - Proper $ref usage for shared schemas
     - x-webhooks for webhook events
   
   - src/docs/updater.ts — SpecUpdater class
     - Diff existing spec vs new extraction
     - Preserve x-human-edited sections
     - Mark removed endpoints as deprecated
   
   - src/docs/change-detector.ts — ChangeDetector class
     - content-hash: fetch page, hash, compare to stored hash
     - changelog-rss: parse RSS/Atom feed, check for new entries
     - github-release: check GitHub API for new tags
     - Stores state in .adapter-core-state.json
     - Returns { changed: boolean, reason? }
     - Zero LLM cost — only HTTP requests
   
   - src/docs/mapping-generator.ts — auto-generate mapping YAML from spec
     - Infer VFS paths from REST resource patterns
   
   - src/docs/types.ts — all shared types

3. Add CLI commands to src/cli.ts:
   - docs-to-spec (one-shot bootstrap)
   - docs-update (re-crawl + diff, only if changed)
   - docs-check (cheap change detection only, no LLM)

4. Add the docs source type to the mapping spec parser

5. Tests:
   - tests/docs/crawler.test.ts — mock fetch, verify page extraction
   - tests/docs/extractor.test.ts — mock LLM, verify structured extraction
   - tests/docs/generator.test.ts — verify valid OpenAPI output
   - tests/docs/change-detector.test.ts — verify hash comparison, skip-when-unchanged

6. README section on docs-to-spec usage

7. Commit + push

End with IMPLEMENT_COMPLETE.`,
      verification: { type: 'output_contains', value: 'IMPLEMENT_COMPLETE' },
      timeout: 1_200_000,
    })

    .step('demo', {
      agent: 'builder',
      dependsOn: ['implement'],
      task: `Create a demo: use docs-to-spec to generate an adapter for an API with no spec.

Working in ${ROOT}.

Pick a real API that has docs but no published OpenAPI spec. Good candidates:
- Resend (email API) — https://resend.com/docs/api-reference
- Cal.com API — https://cal.com/docs/enterprise-features/api
- Loops.so API — https://loops.so/docs/api-reference

1. Create examples/resend/ (or whichever API)
2. Run the docs-to-spec pipeline against the real docs
3. Save the generated spec + mapping
4. Show it works: SchemaAdapter can load the generated mapping

This proves the pipeline end-to-end with a real API.

Keep output under 30 lines. End with DEMO_COMPLETE.`,
      verification: { type: 'output_contains', value: 'DEMO_COMPLETE' },
      timeout: 600_000,
    })

    .step('review', {
      agent: 'reviewer',
      dependsOn: ['implement', 'demo'],
      task: `Review the docs-to-spec agent in ${ROOT}.

Verify:
1. Crawler respects rate limits and robots.txt
2. Extractor uses structured prompts (not free-form)
3. Generated specs are valid OpenAPI 3.0
4. Updater preserves human edits (x-human-edited)
5. Removed endpoints get deprecated, not deleted
6. CLI commands: docs-to-spec (bootstrap), docs-update (diff), docs-check (cheap hash only)
7. NO scheduled crawl by default — sync is opt-in via mapping YAML
8. ChangeDetector skips crawl+LLM when docs haven't changed (content-hash)
9. Demo generates a real spec from real API docs
10. No hardcoded LLM keys — configurable endpoint
11. .adapter-core-state.json stores hashes (gitignored, not committed)

The key test: does docs-check cost zero LLM tokens when nothing changed?
And: could someone bootstrap with just "npx adapter-core docs-to-spec --url ..."?

Fix issues. Keep under 50 lines. End with REVIEW_COMPLETE.`,
      verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
      timeout: 300_000,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: ROOT });

  console.log('Docs-to-spec agent complete:', result.status);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
