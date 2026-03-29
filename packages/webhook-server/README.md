# @relayfile/webhook-server

Thin [Hono](https://hono.dev) server for receiving provider webhooks, verifying signatures, and persisting normalized events into relayfile via `RelayFileClient`.

## Install

```bash
npm install @relayfile/webhook-server hono
```

## Usage

```ts
import { GitHubAdapter } from "@relayfile/adapter-github";
import { RelayFileClient } from "@relayfile/sdk";
import { createWebhookServer } from "@relayfile/webhook-server";

const client = new RelayFileClient({ token: process.env.RELAYFILE_TOKEN! });
const provider = { name: "nango", proxy: async () => ({ status: 200, headers: {}, data: {} }), healthCheck: async () => true };
const github = new GitHubAdapter(provider);
const server = createWebhookServer({ client, port: 3456, secrets: { github: process.env.GITHUB_WEBHOOK_SECRET } });
server.register("github", github);
await server.start();
```

`POST /github/webhook` now verifies `x-hub-signature-256`, normalizes the event, computes a VFS path from the registered adapter, and calls `client.ingestWebhook(...)`.

## Supported built-ins

- `github`: HMAC-SHA256 verification via `x-hub-signature-256`
- `slack`: signing secret verification via `x-slack-signature` and `x-slack-request-timestamp`

Adapters can also provide their own `verifySignature` or `normalizeWebhook` hooks.

## API

### `createWebhookServer(options)`

- `client`: `RelayFileClient` used to persist webhook events
- `workspaceId`: relayfile workspace ID, defaults to `"default"`
- `port`: default port for `server.start()`, defaults to `3456`
- `hostname`: default hostname for `server.start()`, defaults to `"0.0.0.0"`
- `adapters`: optional initial adapter map
- `secrets`: provider-to-secret map for signature verification

### `server.register(name, adapter)`

Registers an adapter by provider name. The adapter may expose:

- `computePath(objectType, objectId, payload?)`
- `normalizeWebhook(payload, context)`
- `verifySignature(context)`
- `provider?: ConnectionProvider`

### Route

- `POST /:provider/webhook`

The route returns `404` for unknown providers, `401` for signature failures, `400` for invalid payloads, and `200` with the queued relayfile operation IDs when the webhook is accepted.
