/**
 * 060-gitlab-adapter.ts
 *
 * Build @relayfile/adapter-gitlab — full GitLab adapter.
 *
 * GitLab REST API: https://docs.gitlab.com/api/rest/
 * Merge Requests: https://docs.gitlab.com/api/merge_requests/
 * Webhooks: https://docs.gitlab.com/user/project/integrations/webhook_events/
 *
 * GitLab is the most direct GitHub analog. Same concepts, different names:
 *   GitHub PR → GitLab Merge Request
 *   GitHub Actions → GitLab CI/CD Pipelines
 *   GitHub Check Runs → GitLab Pipeline Jobs
 *   GitHub Reviews → GitLab Approvals + Discussions
 *
 * The adapter maps GitLab's data model to relayfile VFS paths and normalizes
 * webhooks to WebhookInput events.
 *
 * Run: npx tsx workflows/060-gitlab-adapter.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const ROOT = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-gitlab';
const SDK_ROOT = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const GH_ADAPTER = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';

async function main() {
  const result = await workflow('gitlab-adapter')
    .description('Build @relayfile/adapter-gitlab — full GitLab merge request, pipeline, and webhook adapter')
    .pattern('linear')
    .channel('wf-gitlab-adapter')
    .maxConcurrency(2)
    .timeout(3_600_000)

    .agent('architect', { cli: 'claude', role: 'Designs the GitLab adapter based on API docs and GitHub adapter pattern' })
    .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements the full adapter' })
    .agent('reviewer', { cli: 'codex', preset: 'worker', role: 'Reviews and tests' })

    .step('design', {
      agent: 'architect',
      task: `Design @relayfile/adapter-gitlab based on the GitHub adapter pattern.

READ the GitHub adapter for reference (this is what we're mirroring for GitLab):
- ${GH_ADAPTER}/src/ — full implementation
- ${GH_ADAPTER}/src/types.ts — types
- ${GH_ADAPTER}/github.mapping.yaml — VFS path mapping

READ the relayfile SDK provider interface:
- ${SDK_ROOT}/packages/sdk/typescript/src/provider.ts — IntegrationProvider
- ${SDK_ROOT}/packages/sdk/typescript/src/types.ts — WebhookInput, computeCanonicalPath

FETCH GitLab API docs to understand the data model:
- https://docs.gitlab.com/api/merge_requests/
- https://docs.gitlab.com/api/notes/ (comments)
- https://docs.gitlab.com/api/pipelines/
- https://docs.gitlab.com/api/issues/
- https://docs.gitlab.com/api/commits/
- https://docs.gitlab.com/api/repository_files/
- https://docs.gitlab.com/user/project/integrations/webhook_events/

Design the adapter with these components:

**1. VFS Path Mapping (gitlab.mapping.yaml)**:
\`\`\`
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/metadata.json
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/diff.patch
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/discussions/{id}.json
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/approvals.json
/gitlab/projects/{namespace}/{project}/issues/{iid}/metadata.json
/gitlab/projects/{namespace}/{project}/commits/{sha}/metadata.json
/gitlab/projects/{namespace}/{project}/pipelines/{id}/metadata.json
/gitlab/projects/{namespace}/{project}/pipelines/{id}/jobs/{id}.json
\`\`\`

**2. Webhook Normalization** — GitLab webhook event types:
- merge_request (open, close, merge, update, approve, unapprove)
- note (comment on MR, issue, commit, snippet)
- push (commits pushed)
- pipeline (status changes)
- issue (open, close, update)
- deployment (created, updated, failed)
- tag_push
- job (status changes)

Each maps to WebhookInput: { provider: 'gitlab', objectType, objectId, eventType, payload }

**3. Key differences from GitHub**:
- GitLab uses path_with_namespace (e.g., "acme/api") vs owner/repo
- GitLab uses iid (internal ID) for MRs/issues, not global IDs
- GitLab reviews = approvals + discussions (no "review" object)
- GitLab CI = pipelines with jobs (not check suites with check runs)
- GitLab comments are "notes" with a "noteable_type" discriminator
- GitLab diffs via /merge_requests/:iid/changes or /merge_requests/:iid/diffs
- Webhook verification: X-Gitlab-Token header (shared secret, not HMAC)

**4. Writeback rules**:
- /gitlab/.../merge_requests/{iid}/metadata.json → PUT /api/v4/projects/:id/merge_requests/:iid
- /gitlab/.../merge_requests/{iid}/discussions/ → POST /api/v4/projects/:id/merge_requests/:iid/discussions
- /gitlab/.../issues/{iid}/metadata.json → PUT /api/v4/projects/:id/issues/:iid

**5. File structure**:
\`\`\`
src/
  adapter.ts         — GitLabAdapter extends IntegrationAdapter
  types.ts           — GitLab-specific types
  path-mapper.ts     — computePath() for GitLab resources
  webhook/
    router.ts        — webhook event type → handler
    normalizer.ts    — raw GitLab webhook → WebhookInput
    verify.ts        — X-Gitlab-Token verification
  mr/
    ingestion.ts     — merge request ingestion
    diff-parser.ts   — GitLab diff format parsing
    discussions.ts   — discussion/note mapping
    approvals.ts     — approval state mapping
  pipeline/
    ingestion.ts     — pipeline + job ingestion
    job-mapper.ts    — map job status to relayfile operations
  issues/
    ingestion.ts     — issue ingestion
  commits/
    ingestion.ts     — commit ingestion
  writeback.ts       — VFS path → GitLab API endpoint
  bulk-ingest.ts     — full project ingestion via API
gitlab.mapping.yaml  — declarative path mapping
\`\`\`

Keep output under 80 lines. End with DESIGN_COMPLETE.`,
      verification: { type: 'output_contains', value: 'DESIGN_COMPLETE' },
      timeout: 300_000,
    })

    .step('implement', {
      agent: 'builder',
      dependsOn: ['design'],
      task: `Implement @relayfile/adapter-gitlab — the full GitLab adapter.

Design: {{steps.design.output}}

Working in ${ROOT}.

Build ALL components:
1. gitlab.mapping.yaml — VFS path mapping rules
2. src/types.ts — GitLab-specific types (MergeRequest, Pipeline, Job, Note, etc.)
3. src/adapter.ts — main GitLabAdapter class
4. src/path-mapper.ts — computePath() 
5. src/webhook/ — router, normalizer, verify (X-Gitlab-Token)
6. src/mr/ — MR ingestion, diff parser, discussions, approvals
7. src/pipeline/ — pipeline + job ingestion  
8. src/issues/ — issue ingestion
9. src/commits/ — commit ingestion
10. src/writeback.ts — path pattern → API endpoint mapping
11. src/bulk-ingest.ts — full project ingestion
12. src/index.ts — re-exports

Key implementation details:
- GitLab API base: /api/v4/projects/:id (project ID or URL-encoded path)
- Webhook verification: compare X-Gitlab-Token header to configured secret
- MR diffs: GET /projects/:id/merge_requests/:iid/diffs (returns array of diff objects)
- Notes/discussions: GET /projects/:id/merge_requests/:iid/discussions
- Approvals: GET /projects/:id/merge_requests/:iid/approvals
- Pipeline jobs: GET /projects/:id/pipelines/:id/jobs
- Pagination: page + per_page params, Link header for next page

Tests:
- Webhook normalization for each event type
- Path mapping for MRs, issues, pipelines, commits
- Writeback rule matching
- E2E ingestion test with mock data

README with:
- Quick start
- Supported webhook events
- VFS path structure
- Comparison with GitHub adapter

npm install, build check, commit feat/full-adapter, push.
End with IMPLEMENT_COMPLETE.`,
      verification: { type: 'output_contains', value: 'IMPLEMENT_COMPLETE' },
      timeout: 1_200_000,
    })

    .step('review', {
      agent: 'reviewer',
      dependsOn: ['implement'],
      task: `Review @relayfile/adapter-gitlab in ${ROOT}.
Verify:
- All webhook event types handled (merge_request, note, push, pipeline, issue, deployment, tag_push, job)
- VFS paths use path_with_namespace and iid (not global ID)
- Discussions mapped correctly (GitLab discussions ≠ GitHub reviews)
- Pipeline/job status mapping complete
- Writeback rules cover MR updates, comments, issue updates
- X-Gitlab-Token verification (not HMAC)
- No hardcoded tokens
- Tests for each component
- README documents all paths and events
Fix issues. Keep under 50 lines. End with REVIEW_COMPLETE.`,
      verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
      timeout: 300_000,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: ROOT });

  console.log('GitLab adapter complete:', result.status);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
