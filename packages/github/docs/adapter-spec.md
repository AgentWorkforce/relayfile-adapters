# Relayfile Plugin Ecosystem Spec

## 1. Overview

A composable plugin system for Relayfile with three layers:

1. **SDK Plugin Interface** — in `@relayfile/sdk` (existing repo)
2. **Connection Providers** — how you authenticate (each its own repo/package)
3. **Adapters** — how external data maps to the filesystem (each its own repo/package)

## 2. Package Taxonomy

```
@relayfile/sdk                    ← Plugin interface (IntegrationProvider, AdapterRegistry)
  ↑
@relayfile/provider-nango         ← Connection provider: Nango (OAuth, proxy, token refresh)
@relayfile/provider-composio      ← Connection provider: Composio (tool auth, action execution)

  ↑
@relayfile/adapter-github         ← Adapter: GitHub → relayfile VFS
@relayfile/adapter-slack          ← Adapter: Slack → relayfile VFS
@relayfile/adapter-linear         ← Adapter: Linear → relayfile VFS
@relayfile/adapter-jira           ← Adapter: Jira → relayfile VFS
```

### Naming Convention
- **Provider** (`@relayfile/provider-*`) = authentication/connection layer
  - Handles OAuth flows, token refresh, API proxying
  - Does NOT know about relayfile paths or semantics
  - Think: "how do I talk to this service?"

- **Adapter** (`@relayfile/adapter-*`) = data mapping layer
  - Handles webhook → file path mapping, semantics, bulk ingest
  - Uses a provider for authenticated API calls
  - Think: "what does this service's data look like as files?"

### Dependency Flow
```
adapter-github
  → provider-nango (for GitHub API calls via Nango proxy)
  → @relayfile/sdk (for IntegrationProvider interface)

adapter-github
  → provider-composio (alternative: use Composio for GitHub)
  → @relayfile/sdk

adapter-github
  → @relayfile/sdk
```

An adapter can work with ANY provider — they're decoupled:
```typescript
import { GitHubAdapter } from '@relayfile/adapter-github';
import { NangoProvider } from '@relayfile/provider-nango';
import { ComposioProvider } from '@relayfile/provider-composio';

// Same adapter, different credential backends
const ghViaNango = new GitHubAdapter(client, new NangoProvider({ secretKey }));
const ghViaComposio = new GitHubAdapter(client, new ComposioProvider({ apiKey }));
```

**Relayfile never stores credentials.** Nango and Composio are the credential vaults — providers are thin proxies that delegate auth to those services.

## 3. Repos

| Package | Repo | Purpose |
|---------|------|---------|
| `@relayfile/sdk` | `AgentWorkforce/relayfile` (existing) | Plugin interface, registry, types |
| `@relayfile/provider-nango` | `AgentWorkforce/relayfile-provider-nango` | Nango connection provider |
| `@relayfile/provider-composio` | `AgentWorkforce/relayfile-provider-composio` | Composio connection provider |

| `@relayfile/adapter-github` | `AgentWorkforce/relayfile-adapter-github` | GitHub adapter |
| `@relayfile/adapter-slack` | `AgentWorkforce/relayfile-adapter-slack` | Slack adapter |
| `@relayfile/adapter-linear` | `AgentWorkforce/relayfile-adapter-linear` | Linear adapter |

## 4. Provider Interface

```typescript
// In @relayfile/sdk
export interface ConnectionProvider {
  readonly name: string;  // "nango", "composio"
  
  // Make an authenticated API call to the external service
  proxy(request: ProxyRequest): Promise<ProxyResponse>;
  
  // Check connection health
  healthCheck(connectionId: string): Promise<boolean>;
  
  // Optional: handle incoming webhooks from the connection service
  handleWebhook?(rawPayload: unknown): Promise<NormalizedWebhook>;
}

export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  baseUrl: string;           // e.g. https://api.github.com
  endpoint: string;          // e.g. /repos/owner/repo/contents/path
  connectionId: string;      // Nango connection ID or Composio entity ID
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface NormalizedWebhook {
  provider: string;          // "github", "slack", etc.
  connectionId: string;
  eventType: string;         // "pull_request.opened", "message.created"
  objectType: string;        // "pull_request", "message"
  objectId: string;
  payload: Record<string, unknown>;
}
```

## 5. Adapter Interface

```typescript
// In @relayfile/sdk
export abstract class IntegrationAdapter {
  protected readonly client: RelayFileClient;
  protected readonly provider: ConnectionProvider;
  abstract readonly name: string;      // "github", "slack", "linear"
  abstract readonly version: string;   // semver

  constructor(client: RelayFileClient, provider: ConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  // Core: ingest a webhook event into relayfile
  abstract ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook
  ): Promise<IngestResult>;

  // Core: compute relayfile path for a given object
  abstract computePath(objectType: string, objectId: string): string;

  // Core: compute FileSemantics for a given object
  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  // Optional: bulk sync from provider (pull all data)
  sync?(workspaceId: string, options?: SyncOptions): Promise<SyncResult>;

  // Optional: write-back from relayfile to provider
  writeBack?(workspaceId: string, path: string, content: string): Promise<void>;

  // Optional: list supported webhook events
  supportedEvents?(): string[];
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}
```

## 6. GitHub Adapter Details

### Filesystem Layout
```
/github/repos/{owner}/{repo}/
  meta.json
  pulls/{number}/
    meta.json
    diff.patch
    files/{path}              # head revision
    base/{path}               # base revision
    commits/{sha}.json
    reviews/{review_id}.json
    comments/{comment_id}.json
    checks/{check_id}.json
  issues/{number}/
    meta.json
    comments/{comment_id}.json
  branches/{name}.json
  actions/runs/{run_id}.json
```

### Supported Events
- `pull_request.opened` / `pull_request.synchronize` / `pull_request.closed`
- `pull_request_review.submitted`
- `pull_request_review_comment.created`
- `push`
- `issues.opened` / `issues.closed`
- `check_run.completed`

### File Content Fetching
```typescript
// Adapter uses provider.proxy() to fetch file contents
const content = await this.provider.proxy({
  method: 'GET',
  baseUrl: 'https://api.github.com',
  endpoint: `/repos/${owner}/${repo}/contents/${path}?ref=${sha}`,
  connectionId,
});
```

## 7. Nango Provider Details

```typescript
export class NangoProvider implements ConnectionProvider {
  readonly name = 'nango';
  
  constructor(private config: { 
    secretKey: string;
    baseUrl?: string;  // default: https://api.nango.dev
  }) {}

  async proxy(request: ProxyRequest): Promise<ProxyResponse> {
    // Uses Nango proxy API: POST /proxy
    // Nango handles OAuth token injection automatically
    const response = await fetch(`${this.config.baseUrl}/proxy`, {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${this.config.secretKey}`,
        'Connection-Id': request.connectionId,
        'Provider-Config-Key': 'github', // or derived from request
      },
      body: JSON.stringify({
        baseUrlOverride: request.baseUrl,
        endpoint: request.endpoint,
        headers: request.headers,
        data: request.body,
        params: request.query,
      }),
    });
    
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data: await response.json(),
    };
  }

  async healthCheck(connectionId: string): Promise<boolean> {
    // GET /connection/{connectionId}
  }

  async handleWebhook(rawPayload: unknown): Promise<NormalizedWebhook> {
    // Normalize Nango webhook format to NormalizedWebhook
  }
}
```

## 8. Scoped Access for Review Agents (MSD Integration)

When a PR webhook arrives:
1. Adapter writes PR data to relayfile workspace
2. Orchestrator mints a relayauth token scoped to `fs:read` on `/github/repos/{owner}/{repo}/pulls/{number}/**`
3. Review agents receive the token and workspace URL
4. Agents read code exclusively through `GET /v1/workspaces/:id/fs/file?path=...`
5. Review results written back via adapter's `writeBack()` method
6. Token revoked when review completes

## 9. Workflow Breakdown (45 total)

### Phase 1: SDK Plugin Interface (001-010) — in @relayfile/sdk repo
Plugin types, adapter registry, provider interface, webhook routing, test helpers, CLI scaffold, loader, validation, events, E2E

### Phase 2: Provider Implementation (011-018) — @relayfile/provider-nango repo
Nango scaffold, proxy implementation, webhook normalization, connection health, token refresh, connection listing, provider E2E, provider test fixtures

### Phase 3: GitHub Adapter Core (019-030) — @relayfile/adapter-github repo
Scaffold, PR ingestion, commit mapping, file content fetching, semantics, review mapping, check runs, issue mapping, webhook router, diff parser, bulk ingest, incremental sync

### Phase 4: Review Integration (031-038) — @relayfile/adapter-github repo
Workspace lifecycle, scoped tokens, agent dispatch, writeback, orchestrator, concurrent PRs, comment threading, status checks

### Phase 5: Ecosystem & Quality (039-045) — various repos
Adapter docs generator, publish pipeline, error catalog, rate limiting, telemetry, composio provider scaffold, full system E2E
