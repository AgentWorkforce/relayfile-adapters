# @relayfile/adapter-teams

Microsoft Teams adapter for relayfile. It maps Teams teams, channels, messages, replies, chats, memberships, and change notifications into deterministic VFS paths under `/teams`.

## Quick start

1. Register a Microsoft Entra app with Microsoft Graph application permissions for the scopes you need.
2. Configure a public HTTPS notification endpoint that can echo `validationToken` as plain text for Graph subscription handshakes.
3. Create a relayfile client and instantiate `TeamsAdapter`.
4. Create Graph subscriptions for tenant, team, channel, or chat scopes.
5. Route incoming Graph notifications into `adapter.ingestWebhook(...)`.

```ts
import { RelayFileClient } from '@relayfile/sdk';
import { TeamsAdapter, createValidationResponse, extractValidationToken } from '@relayfile/adapter-teams';

const client = new RelayFileClient({
  baseUrl: process.env.RELAYFILE_BASE_URL!,
  token: process.env.RELAYFILE_TOKEN!,
});

const adapter = new TeamsAdapter(client, {
  accessToken: async () => process.env.MS_GRAPH_TOKEN!,
  connectionId: 'teams-primary',
  clientState: process.env.TEAMS_CLIENT_STATE,
  notificationUrl: 'https://example.com/api/teams/notifications',
  includeResourceData: true,
  encryptionCertificate: process.env.TEAMS_CERT_BASE64,
  encryptionCertificateId: 'teams-cert-1',
  privateKeyPem: process.env.TEAMS_PRIVATE_KEY_PEM,
});

export async function handleTeamsNotification(request: Request) {
  const url = new URL(request.url);
  const validation = extractValidationToken(Object.fromEntries(url.searchParams.entries()));
  if (validation.isValidation) {
    const response = createValidationResponse(validation.validationToken!);
    return new Response(response.body, { status: response.statusCode, headers: response.headers });
  }

  await adapter.ingestWebhook('ws_acme', {
    queryParams: Object.fromEntries(url.searchParams.entries()),
    body: await request.json(),
  });

  return new Response(null, { status: 202 });
}
```

## Graph app registration

1. Create a Microsoft Entra app registration for the adapter.
2. Create a client secret or certificate for your token acquisition flow.
3. Add Microsoft Graph application permissions that match the resources you will ingest:
- Channel messages and replies: `ChannelMessage.Read.All`
- Chat messages: `Chat.Read.All`
- Teams and channels metadata: `Team.ReadBasic.All`
- Team members: `TeamMember.Read.All`
4. Grant tenant-wide admin consent for the application permissions.
5. If you enable `includeResourceData`, configure an X.509 certificate on the Graph subscription and provide the matching `privateKeyPem` to the adapter so encrypted notification payloads can be decrypted.
6. Expose a public HTTPS `notificationUrl` and, if you want lifecycle callbacks, a `lifecycleNotificationUrl`.

## Change notification flow

```text
Graph subscription
  -> POST notificationUrl?validationToken=...
  -> adapter validation helper echoes token

Graph event delivery
  -> TeamsAdapter.ingestWebhook()
  -> clientState verification
  -> rich notification decrypt OR basic notification fetch
  -> objectType + objectId normalization
  -> relayfile writeFile() calls
  -> VFS paths under /teams
```

## VFS path structure

```text
/teams/{teamId}/metadata.json
/teams/{teamId}/channels/{channelId}/metadata.json
/teams/{teamId}/channels/{channelId}/messages/{messageId}.json
/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}.json
/teams/{teamId}/channels/{channelId}/tabs/{tabId}.json
/teams/{teamId}/channels/{channelId}/messages/{messageId}/reactions/{reactionType}--{userId}.json
/teams/{teamId}/members/{userId}.json
/teams/chats/{chatId}/metadata.json
/teams/chats/{chatId}/messages/{messageId}.json
```

## Subscription presets

- Tenant: `/teams/getAllMessages`, `/chats/getAllMessages`, `/teams/getAllChannels`, `/teams`
- Team: `/teams/{teamId}/channels`, `/teams/{teamId}/members`, `/teams/{teamId}`
- Channel: `/teams/{teamId}/channels/{channelId}/messages`
- Chat: `/chats/{chatId}/messages`

The adapter clamps default expirations to 59 minutes and defaults to 55 minutes to stay within the short message subscription lifetime.
Use `shouldRenewSubscription()` to decide when to renew a subscription before Graph expires it.

## Incremental sync

`bulkIngestTeam()` supports both full message listing and delta mode. Delta mode uses `/teams/{teamId}/channels/{channelId}/messages/delta` and returns channel-specific `@odata.deltaLink` values you can store and reuse.

## Comparison with Slack adapter

- Auth: Teams uses Graph bearer tokens; Slack uses Slack app tokens.
- Event model: Teams uses Graph subscriptions and change notifications; Slack uses event callbacks.
- Message format: Teams bodies are HTML; Slack bodies are text or block structures.
- Threading: Teams replies use `replyToId`; Slack uses `thread_ts`.
- Hierarchy: Teams is `team -> channel -> message`; Slack is `workspace -> channel -> message`.
- Files: Teams file references point to SharePoint-backed objects; Slack includes file objects directly in events.

## Graph references

- Teams overview: https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview?view=graph-rest-1.0
- chatMessage resource: https://learn.microsoft.com/en-us/graph/api/resources/chatmessage?view=graph-rest-1.0
- channel resource: https://learn.microsoft.com/en-us/graph/api/resources/channel?view=graph-rest-1.0
- Teams message change notifications: https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatMessage
- Change notifications overview: https://learn.microsoft.com/en-us/graph/change-notifications-overview
