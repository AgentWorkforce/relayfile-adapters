/**
 * 061-teams-adapter.ts
 *
 * Build @relayfile/adapter-teams — full Microsoft Teams adapter.
 *
 * Microsoft Graph Teams API: https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview
 * Chat Messages: https://learn.microsoft.com/en-us/graph/api/resources/chatmessage
 * Change Notifications: https://learn.microsoft.com/en-us/graph/change-notifications-overview
 * Webhooks: https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/what-are-webhooks-and-connectors
 *
 * Teams is in the "messaging" category alongside Slack. Same domain:
 *   Slack channels → Teams channels
 *   Slack messages → Teams chatMessages
 *   Slack threads → Teams reply threads (replyToId)
 *   Slack reactions → Teams reactions (setReaction/unsetReaction)
 *   Slack apps → Teams apps (teamsAppInstallation)
 *
 * Auth: Microsoft Graph API via OAuth2 (Bearer token from provider).
 * Webhooks: Change notifications (subscription-based) or incoming webhooks.
 *
 * Run: npx tsx workflows/061-teams-adapter.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const ROOT = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-teams';
const SDK_ROOT = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const SLACK_ADAPTER = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-slack';

async function main() {
  const result = await workflow('teams-adapter')
    .description('Build @relayfile/adapter-teams — full Microsoft Teams channel, message, and notification adapter')
    .pattern('linear')
    .channel('wf-teams-adapter')
    .maxConcurrency(2)
    .timeout(3_600_000)

    .agent('architect', { cli: 'claude', role: 'Designs the Teams adapter based on Graph API docs and Slack adapter pattern' })
    .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements the full adapter' })
    .agent('reviewer', { cli: 'codex', preset: 'worker', role: 'Reviews and tests' })

    .step('design', {
      agent: 'architect',
      task: `Design @relayfile/adapter-teams based on the Slack adapter pattern.

READ the Slack adapter for reference (messaging category sibling):
- ${SLACK_ADAPTER}/src/ — implementation

READ the relayfile SDK:
- ${SDK_ROOT}/packages/sdk/typescript/src/provider.ts — IntegrationProvider
- ${SDK_ROOT}/packages/sdk/typescript/src/types.ts — WebhookInput

FETCH Microsoft Graph Teams API docs:
- https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/resources/chatmessage?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/resources/channel?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatMessage
- https://learn.microsoft.com/en-us/graph/change-notifications-overview

Design the adapter:

**1. VFS Path Mapping**:
\`\`\`
/teams/{teamId}/channels/{channelId}/metadata.json
/teams/{teamId}/channels/{channelId}/messages/{messageId}.json
/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}.json
/teams/{teamId}/channels/{channelId}/tabs/{tabId}.json
/teams/{teamId}/metadata.json
/teams/{teamId}/members/{userId}.json
/teams/chats/{chatId}/messages/{messageId}.json          (1:1 and group chats)
/teams/chats/{chatId}/metadata.json
\`\`\`

**2. Change Notification Events** (Microsoft Graph subscriptions):
Teams doesn't use traditional webhooks — it uses Graph Change Notifications:
- chatMessage (created, updated, deleted) — in channels and chats
- channel (created, deleted, updated)
- team (updated, deleted)
- conversationMember (added, removed)
- teamsAppInstallation (installed, uninstalled)

Change notifications deliver:
- Basic: just resource URL + change type
- Rich: includes encrypted resource data (requires certificate for decryption)

We handle BOTH: basic (fetch data on notification) and rich (decrypt inline).

**3. Key differences from Slack**:
- Auth: OAuth2 Bearer token via Microsoft Graph (not Slack's xoxb/xoxp)
- API base: https://graph.microsoft.com/v1.0 (not slack.com/api)
- Webhooks: subscription-based change notifications (POST /subscriptions)
  with validation token handshake, NOT Slack's event API
- Subscription lifecycle: max 60min for chatMessage, must renew
- Message format: HTML body content (not Slack blocks/mrkdwn)
- Threads: replyToId field (not Slack's thread_ts)
- Teams → team/channel hierarchy (Slack → workspace/channel)
- Files: stored in SharePoint, not inline (adapter just stores reference)
- Reactions: emoji name on chatMessage (setReaction/unsetReaction API)

**4. Writeback rules**:
- /teams/.../messages/{id}.json → POST /teams/{id}/channels/{id}/messages
  (send message to channel)
- /teams/.../messages/{id}/replies/ → POST /teams/{id}/channels/{id}/messages/{id}/replies
  (reply to thread)
- /teams/chats/{chatId}/messages/ → POST /chats/{chatId}/messages
  (send chat message)

**5. Subscription management**:
The adapter needs to manage Graph subscriptions:
- createSubscription(resource, changeType, notificationUrl, expirationDateTime)
- renewSubscription(subscriptionId, expirationDateTime)
- deleteSubscription(subscriptionId)
- handleValidation(validationToken) → respond with token for handshake

**6. File structure**:
\`\`\`
src/
  adapter.ts           — TeamsAdapter extends IntegrationAdapter
  types.ts             — Teams-specific types
  path-mapper.ts       — computePath() for Teams resources
  notification/
    handler.ts         — change notification processor
    validator.ts       — validation token handshake
    decryptor.ts       — rich notification decryption (optional)
    subscription.ts    — subscription lifecycle management
  channels/
    ingestion.ts       — channel + team ingestion
    messages.ts        — message + reply ingestion
    reactions.ts       — reaction tracking
  chats/
    ingestion.ts       — 1:1 and group chat ingestion
  members/
    ingestion.ts       — team/channel membership
  writeback.ts         — VFS path → Graph API endpoint
  bulk-ingest.ts       — full team ingestion
teams.mapping.yaml     — declarative path mapping
\`\`\`

Keep output under 80 lines. End with DESIGN_COMPLETE.`,
      verification: { type: 'output_contains', value: 'DESIGN_COMPLETE' },
      timeout: 300_000,
    })

    .step('implement', {
      agent: 'builder',
      dependsOn: ['design'],
      task: `Implement @relayfile/adapter-teams — the full Microsoft Teams adapter.

Design: {{steps.design.output}}

Working in ${ROOT}.

Build ALL components:
1. teams.mapping.yaml — VFS path mapping rules
2. src/types.ts — Teams types (Team, Channel, ChatMessage, Subscription, etc.)
3. src/adapter.ts — TeamsAdapter class
4. src/path-mapper.ts — computePath()
5. src/notification/ — change notification handler, validator, subscription management
6. src/channels/ — channel/message/reaction ingestion
7. src/chats/ — chat message ingestion
8. src/members/ — membership ingestion
9. src/writeback.ts — path → Graph API endpoint
10. src/bulk-ingest.ts — full team ingestion
11. src/index.ts — re-exports

Key implementation details:
- Graph API base: https://graph.microsoft.com/v1.0
- Auth: Authorization: Bearer {token} (token from provider)
- Change notification validation: POST to notificationUrl with validationToken query param
  → must respond 200 with validationToken as plain text body
- Subscription creation: POST /subscriptions with resource, changeType, notificationUrl, 
  expirationDateTime, clientState (for verification)
- clientState is sent back in each notification — verify it matches
- Message content is HTML in body.content (contentType: "html")
- Pagination: @odata.nextLink URL for next page
- Delta queries: /teams/{id}/channels/{id}/messages/delta for incremental sync

Tests:
- Notification validation handshake
- clientState verification
- Path mapping for all resource types  
- Message ingestion with replies
- Writeback rule matching
- Subscription lifecycle

README with:
- Quick start (Graph API setup, app registration)
- Change notification flow diagram
- VFS path structure
- Comparison with Slack adapter

npm install, build check, commit feat/full-adapter, push.
End with IMPLEMENT_COMPLETE.`,
      verification: { type: 'output_contains', value: 'IMPLEMENT_COMPLETE' },
      timeout: 1_200_000,
    })

    .step('review', {
      agent: 'reviewer',
      dependsOn: ['implement'],
      task: `Review @relayfile/adapter-teams in ${ROOT}.
Verify:
- Change notification handling correct (validation handshake, clientState check)
- Subscription lifecycle (create, renew before expiry, delete)
- Message threading via replyToId (not thread_ts)
- HTML body content handling
- Channel vs chat message paths differentiated
- Writeback for messages and replies
- @odata.nextLink pagination
- No hardcoded tokens or tenant IDs
- Tests cover notification flow, path mapping, writeback
- README documents Graph app registration and permissions needed
Fix issues. Keep under 50 lines. End with REVIEW_COMPLETE.`,
      verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
      timeout: 300_000,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: ROOT });

  console.log('Teams adapter complete:', result.status);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
