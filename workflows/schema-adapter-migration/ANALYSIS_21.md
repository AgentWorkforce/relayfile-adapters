# Workflow 21 — Implementation Brief: ResourceMapping Pagination + Sync

## Scope

Extend `ResourceMapping` in `packages/core/src/spec/types.ts` with an optional
`pagination` block (five strategies) and an optional `sync` block
(`modelName`/`cursorField`/`checkpointKey`).  Teach `parser.ts` to parse and
validate the new fields.  Add focused `node:test` tests in
`tests/spec/parser.test.ts`.

---

## 1. Exact ResourceMapping Fields — Current State

```ts
// packages/core/src/spec/types.ts (current)
export interface ResourceMapping extends DataProjection {
  endpoint: string;   // required — "METHOD /path" e.g. "GET /repos/{owner}/{repo}/pulls"
  path:     string;   // required — absolute path template e.g. "/github/repos/{{owner}}/pulls/{{id}}/metadata.json"
  iterate?: boolean;  // optional — treat response as an array and iterate items
  // inherited from DataProjection:
  extract?: string[]; // optional — dot-paths to pluck from each item
}
```

---

## 2. New Types to Add

Add these interfaces immediately after the current `ResourceMapping` definition.

### 2a. Pagination discriminated union

```ts
export type PaginationStrategy =
  | "cursor"
  | "offset"
  | "page"
  | "link-header"
  | "next-token";

/** Shared optional field present on all strategy shapes. */
interface PaginationBase {
  strategy: PaginationStrategy;
}

export interface CursorPagination extends PaginationBase {
  strategy: "cursor";
  /** Dot-path into the response body where the next cursor value lives.
   *  REQUIRED for cursor strategy — parser rejects if absent. */
  cursorPath: string;
  /** Query-parameter name to carry the cursor.  Defaults to "cursor". */
  paramName?: string;
}

export interface OffsetPagination extends PaginationBase {
  strategy: "offset";
  /** Query-parameter name for the offset.  Defaults to "offset". */
  paramName?: string;
  /** Query-parameter name for the page size.  Defaults to "limit". */
  limitParamName?: string;
  /** Fixed page size to request. */
  pageSize?: number;
}

export interface PagePagination extends PaginationBase {
  strategy: "page";
  /** Query-parameter name for the page number.  Defaults to "page". */
  paramName?: string;
  /** Query-parameter name for the page size.  Defaults to "per_page". */
  limitParamName?: string;
  /** Fixed page size to request. */
  pageSize?: number;
}

export interface LinkHeaderPagination extends PaginationBase {
  strategy: "link-header";
  // No extra fields; the runtime reads the RFC 5988 `Link: <url>; rel="next"` header.
}

export interface NextTokenPagination extends PaginationBase {
  strategy: "next-token";
  /** Dot-path into the response body where the next page token lives.
   *  REQUIRED for next-token strategy — parser rejects if absent. */
  tokenPath: string;
  /** Query-parameter name to carry the token.  Defaults to "nextToken". */
  paramName?: string;
}

export type PaginationConfig =
  | CursorPagination
  | OffsetPagination
  | PagePagination
  | LinkHeaderPagination
  | NextTokenPagination;
```

### 2b. Sync metadata block

```ts
export interface ResourceSyncConfig {
  /** Canonical model name consumed by workflow 22's SchemaAdapter.sync(). */
  modelName: string;
  /** Dot-path in the resource item that carries the cursor / updated-at value
   *  used to checkpoint incremental syncs.  Required when pagination.strategy
   *  is "cursor" or "next-token". */
  cursorField?: string;
  /** Key under which the sync checkpoint is stored in the state store. */
  checkpointKey?: string;
}
```

### 2c. Updated ResourceMapping

```ts
export interface ResourceMapping extends DataProjection {
  endpoint: string;
  path:     string;
  iterate?: boolean;
  pagination?: PaginationConfig;
  sync?: ResourceSyncConfig;
}
```

---

## 3. Parser Rules

### 3a. `parseResourceMapping` additions

Extend the existing function in `parser.ts`:

```ts
function parseResourceMapping(input: Record<string, unknown>) {
  return {
    endpoint:   readRequiredString(input.endpoint, "endpoint"),
    path:       readRequiredString(input.path, "path"),
    iterate:    input.iterate === true,
    extract:    readOptionalStringArray(input.extract),
    pagination: input.pagination !== undefined
                  ? parsePaginationConfig(asRecord(input.pagination, "pagination"))
                  : undefined,
    sync:       input.sync !== undefined
                  ? parseResourceSyncConfig(asRecord(input.sync, "sync"))
                  : undefined,
  };
}
```

### 3b. `parsePaginationConfig`

```ts
const SUPPORTED_STRATEGIES = new Set([
  "cursor", "offset", "page", "link-header", "next-token",
]);

function parsePaginationConfig(
  input: Record<string, unknown>
): PaginationConfig {
  const strategy = readRequiredString(input.strategy, "pagination.strategy");

  if (!SUPPORTED_STRATEGIES.has(strategy)) {
    throw new Error(
      `pagination.strategy "${strategy}" is not supported. ` +
      `Must be one of: ${[...SUPPORTED_STRATEGIES].join(", ")}`
    );
  }

  switch (strategy) {
    case "cursor": {
      const cursorPath = readRequiredString(input.cursorPath, "pagination.cursorPath");
      // cursorPath MUST be a non-empty string — readRequiredString already throws if not.
      return {
        strategy:   "cursor",
        cursorPath,
        paramName:  readOptionalString(input.paramName),
      };
    }
    case "offset":
      return {
        strategy:       "offset",
        paramName:      readOptionalString(input.paramName),
        limitParamName: readOptionalString(input.limitParamName ?? input.limit_param_name),
        pageSize:       readOptionalNumber(input.pageSize ?? input.page_size),
      };
    case "page":
      return {
        strategy:       "page",
        paramName:      readOptionalString(input.paramName),
        limitParamName: readOptionalString(input.limitParamName ?? input.limit_param_name),
        pageSize:       readOptionalNumber(input.pageSize ?? input.page_size),
      };
    case "link-header":
      return { strategy: "link-header" };
    case "next-token": {
      const tokenPath = readRequiredString(input.tokenPath, "pagination.tokenPath");
      return {
        strategy:  "next-token",
        tokenPath,
        paramName: readOptionalString(input.paramName),
      };
    }
    default:
      // TypeScript exhaustiveness guard — unreachable at runtime.
      throw new Error(`Unhandled pagination strategy: ${strategy}`);
  }
}
```

### 3c. `parseResourceSyncConfig`

```ts
function parseResourceSyncConfig(
  input: Record<string, unknown>
): ResourceSyncConfig {
  return {
    modelName:     readRequiredString(input.modelName ?? input.model_name, "sync.modelName"),
    cursorField:   readOptionalString(input.cursorField ?? input.cursor_field),
    checkpointKey: readOptionalString(input.checkpointKey ?? input.checkpoint_key),
  };
}
```

---

## 4. Rejection Cases

| Case | Field | Error type | Message pattern |
|---|---|---|---|
| Unknown strategy | `pagination.strategy` | `throw` (parse-time) | `pagination.strategy "X" is not supported` |
| Cursor without cursorPath | `pagination.cursorPath` | `throw` (parse-time) | `pagination.cursorPath must be a non-empty string` |
| next-token without tokenPath | `pagination.tokenPath` | `throw` (parse-time) | `pagination.tokenPath must be a non-empty string` |
| sync without modelName | `sync.modelName` | `throw` (parse-time) | `sync.modelName must be a non-empty string` |
| Empty-string strategy | `pagination.strategy` | `throw` (parse-time) | `pagination.strategy must be a non-empty string` |

All five cases are parse-time throws surfaced via `parseMappingSpecText`, so
callers never receive a partially-constructed `MappingSpec`.

---

## 5. Focused Parser Tests to Add

Add to `packages/core/tests/spec/parser.test.ts`.  Use the same
`node:test` + `node:assert/strict` style as the existing tests.

### 5a. Accept: cursor pagination with cursorPath

```ts
test("parseMappingSpecText accepts cursor pagination with cursorPath", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/{{repo}}/pulls/{{id}}/metadata.json
    pagination:
      strategy: cursor
      cursorPath: meta.nextCursor
      paramName: after
`);
  const p = spec.resources?.pulls?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "cursor");
  assert.equal((p as { cursorPath: string }).cursorPath, "meta.nextCursor");
  assert.equal((p as { paramName?: string }).paramName, "after");
});
```

### 5b. Reject: cursor pagination without cursorPath

```ts
test("parseMappingSpecText rejects cursor pagination missing cursorPath", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls.json
    pagination:
      strategy: cursor
`),
    /cursorPath/i
  );
});
```

### 5c. Reject: unsupported pagination strategy

```ts
test("parseMappingSpecText rejects an unsupported pagination strategy", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls.json
    pagination:
      strategy: keyset
`),
    /not supported/i
  );
});
```

### 5d. Accept: offset pagination (no required sub-fields)

```ts
test("parseMappingSpecText accepts offset pagination with optional fields", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  issues:
    endpoint: "GET /repos/{owner}/{repo}/issues"
    path: /github/repos/{{owner}}/issues/{{number}}/metadata.json
    pagination:
      strategy: offset
      pageSize: 100
`);
  const p = spec.resources?.issues?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "offset");
  assert.equal((p as { pageSize?: number }).pageSize, 100);
});
```

### 5e. Accept: page pagination (no required sub-fields)

```ts
test("parseMappingSpecText accepts page pagination", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  issues:
    endpoint: "GET /repos/{owner}/{repo}/issues"
    path: /github/repos/{{owner}}/issues/{{number}}/metadata.json
    pagination:
      strategy: page
      limitParamName: per_page
`);
  const p = spec.resources?.issues?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "page");
});
```

### 5f. Accept: link-header pagination (no sub-fields)

```ts
test("parseMappingSpecText accepts link-header pagination", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  issues:
    endpoint: "GET /repos/{owner}/{repo}/issues"
    path: /github/repos/{{owner}}/issues/{{number}}/metadata.json
    pagination:
      strategy: link-header
`);
  assert.equal(spec.resources?.issues?.pagination?.strategy, "link-header");
});
```

### 5g. Accept: next-token pagination with tokenPath

```ts
test("parseMappingSpecText accepts next-token pagination with tokenPath", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: aws
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  buckets:
    endpoint: "GET /buckets"
    path: /aws/buckets/{{Name}}/metadata.json
    pagination:
      strategy: next-token
      tokenPath: NextContinuationToken
`);
  const p = spec.resources?.buckets?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "next-token");
  assert.equal((p as { tokenPath: string }).tokenPath, "NextContinuationToken");
});
```

### 5h. Reject: next-token pagination without tokenPath

```ts
test("parseMappingSpecText rejects next-token pagination missing tokenPath", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: aws
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  buckets:
    endpoint: "GET /buckets"
    path: /aws/buckets/{{Name}}/metadata.json
    pagination:
      strategy: next-token
`),
    /tokenPath/i
  );
});
```

### 5i. Accept: sync block with modelName

```ts
test("parseMappingSpecText accepts sync block with modelName", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls/{{id}}/metadata.json
    sync:
      modelName: PullRequest
      cursorField: updated_at
      checkpointKey: github:pulls:cursor
`);
  assert.equal(spec.resources?.pulls?.sync?.modelName, "PullRequest");
  assert.equal(spec.resources?.pulls?.sync?.cursorField, "updated_at");
  assert.equal(spec.resources?.pulls?.sync?.checkpointKey, "github:pulls:cursor");
});
```

### 5j. Reject: sync block missing modelName

```ts
test("parseMappingSpecText rejects sync block missing modelName", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls/{{id}}/metadata.json
    sync:
      cursorField: updated_at
`),
    /modelName/i
  );
});
```

---

## 6. Checklist for Downstream Agents

- `codex-types-author` — add the types in §2 to `types.ts`; no parser changes.
- `codex-parser-author` — add `parsePaginationConfig` + `parseResourceSyncConfig`
  in `parser.ts`; thread them into `parseResourceMapping`; keep all existing
  behaviour unchanged.
- `codex-tests-author` — append tests §5a–§5j to `parser.test.ts`; stay in the
  `node:test` style; no new imports needed beyond what the file already has.
- `codex-reviewer` — confirm the diff adds exactly these five strategies, that
  cursor/next-token rejection is present, that sync carries all three fields,
  and that 10 new test cases appear covering accept + reject paths.
