# Mapping YAML Specification

Formal specification for `@relayfile/adapter-core` mapping files (v1).

## Top-Level Keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `adapter` | object | yes | Adapter identity and API source configuration |
| `webhooks` | object | yes | Maps webhook event names to VFS paths (may be `{}`) |
| `resources` | object | no | Maps named resources to API endpoints and VFS paths |
| `writebacks` | object | no | Maps VFS glob patterns to outbound API calls |

## `adapter`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Adapter identifier (used as VFS path prefix) |
| `version` | string | yes | Semver version of the mapping |
| `baseUrl` | string | no | Default base URL for writeback API calls |
| `source` | object | yes | At least one child key is required |

### `adapter.source`

At least one of `openapi`, `postman`, `samples`, or `docs` must be present.

| Field | Type | Description |
|-------|------|-------------|
| `openapi` | string | URL or path to an OpenAPI spec |
| `postman` | string | URL or path to a Postman collection |
| `samples` | string \| string[] | Path(s) to sample payload files |
| `docs` | object | Documentation crawl source (see below) |
| `sync` | object | Change-detection config for docs-backed adapters |
| `llm` | object | LLM config for docs-to-spec extraction |

#### `adapter.source.docs`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Root documentation URL |
| `crawlPaths` | string[] | no | Specific paths to crawl |
| `selectors` | object | no | CSS selectors: `content`, `codeBlock`, `pagination` |
| `maxPages` | number | no | Maximum pages to crawl |
| `rateLimitMs` | number | no | Delay between requests (ms) |

#### `adapter.source.sync`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `trigger` | string | yes | One of `content-hash`, `changelog-rss`, `github-release` |
| `feedUrl` | string | no | RSS feed URL (for `changelog-rss`) |
| `repo` | string | no | GitHub `owner/repo` (for `github-release`) |
| `stateFile` | string | no | Path to persist sync state |

#### `adapter.source.llm`

| Field | Type | Description |
|-------|------|-------------|
| `provider` | string | `anthropic`, `openai`, or `custom` |
| `endpoint` | string | Custom LLM endpoint URL |
| `model` | string | Model identifier |
| `maxTokens` | number | Max tokens per request |
| `concurrency` | number | Parallel extraction requests |
| `chunkSize` | number | Characters per chunk |

## `webhooks`

Each key is an event name (e.g., `pull_request`, `email.sent`). Lookup tries the full event type, then `objectType`, then the prefix before the first `.`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | VFS path template (must start with `/`) |
| `objectType` | string | no | Override object type for file semantics |
| `objectId` | string | no | Override object ID for file semantics |
| `extract` | string[] | no | Subset of payload fields to persist |

## `resources`

Each key is a resource name (e.g., `get-emails`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | yes | API endpoint: `METHOD /path` (e.g., `GET /emails/{email_id}`) |
| `path` | string | yes | VFS path template (must start with `/`) |
| `iterate` | boolean | no | When `true`, iterate over response array items |
| `extract` | string[] | no | Subset of response fields to persist |

## `writebacks`

Each key is a writeback name (e.g., `review`, `send-email`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `match` | string | yes | Glob pattern against VFS paths (uses minimatch) |
| `endpoint` | string | yes | API endpoint: `METHOD /path/{param}` |
| `baseUrl` | string | no | Override `adapter.baseUrl` for this writeback |

Wildcard segments in `match` are positionally mapped to `{param}` placeholders in `endpoint`. For example, `match: /github/repos/*/*/pulls/*/reviews/*.json` with `endpoint: POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` maps the first three wildcards to `{owner}`, `{repo}`, and `{pull_number}`.

## Template Syntax

Path templates use `{{ field }}` (double curly braces) to interpolate values from the webhook payload or API response.

- **Dot notation**: `{{ repository.owner.login }}` traverses nested objects
- **Array indexing**: `{{ items.0.id }}` accesses array elements by index
- **Encoding**: String values are URI-encoded; numbers and booleans are stringified; arrays join with `/`
- **Strict mode**: Missing fields raise an error at runtime (used by `SchemaAdapter`)

Endpoint descriptors use `{param}` (single curly braces) for REST-style path parameters. These are distinct from template interpolation.

## Path Conventions

VFS paths follow the pattern: `/<adapter-name>/<object-type>/<object-id>/metadata.json`

- Always start with `/`
- First segment is the adapter name
- Use plural nouns for collections (e.g., `/repos`, `/emails`)
- Terminal file is typically `metadata.json`

## Validation Rules

The parser enforces:

1. `adapter.name` and `adapter.version` must be non-empty strings
2. At least one source (`openapi`, `postman`, `samples`, or `docs`) is required
3. `docs.url` must be non-empty when `docs` is present
4. Webhook `path` must start with `/`
5. Resource and writeback `endpoint` must match `METHOD /path` (e.g., `GET /resource`)
6. `sync.trigger` must be one of `content-hash`, `changelog-rss`, `github-release`

When a `ServiceSpec` is available, validation also checks that template fields and `extract` fields exist in the referenced schemas.

## Examples

### Minimal

```yaml
adapter:
  name: myservice
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks:
  item.created:
    path: /myservice/items/{{ id }}/metadata.json
```

### Full

```yaml
adapter:
  name: github
  version: "1.0.0"
  baseUrl: https://api.github.com
  source:
    openapi: https://raw.githubusercontent.com/.../api.github.com.yaml
webhooks:
  pull_request:
    path: /github/repos/{{ repository.owner.login }}/{{ repository.name }}/pulls/{{ number }}/metadata.json
    extract:
      - number
      - title
      - state
      - user.login
  issues:
    path: /github/repos/{{ repository.owner.login }}/{{ repository.name }}/issues/{{ number }}/metadata.json
resources:
  get-pull:
    endpoint: GET /repos/{owner}/{repo}/pulls/{pull_number}
    path: /github/repos/{{ owner }}/{{ repo }}/pulls/{{ pull_number }}/metadata.json
writebacks:
  review:
    match: /github/repos/*/*/pulls/*/reviews/*.json
    endpoint: POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
  comment:
    match: /github/repos/*/*/issues/*/comments/*.json
    endpoint: POST /repos/{owner}/{repo}/issues/{issue_number}/comments
```

### Docs-backed (no OpenAPI)

```yaml
adapter:
  name: resend
  version: "1.0.0"
  source:
    docs:
      url: https://resend.com/docs/api-reference/introduction
      crawlPaths:
        - /docs/api-reference/emails/send-email
        - /docs/api-reference/emails/retrieve-email
    llm:
      provider: custom
      endpoint: http://127.0.0.1:8787
      model: resend-demo
webhooks: {}
resources:
  get-emails:
    endpoint: GET /emails/{email_id}
    path: /resend/emails/{{ email_id }}/metadata.json
writebacks: {}
```
