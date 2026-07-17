# @relayfile/relay-helpers

Ergonomic, catalog-backed provider clients for Workforce agent handlers.

The runtime exposes only generic VFS helpers (`writeJsonFile`, `readJsonFile`, …);
the per-provider typed clients (`ctx.linear.comment(...)`) were removed. This
package recovers that ergonomics as an **opt-in factory**, with every path
sourced from [`@relayfile/adapter-core/writeback-paths`](https://www.npmjs.com/package/@relayfile/adapter-core)
(the adapter-owned source of truth) instead of hardcoded — so paths never drift
from the adapter that materializes the draft.

```ts
import { linearClient, githubClient, slackClient } from '@relayfile/relay-helpers';

const linear = linearClient();             // binds the mount root once (RELAYFILE_MOUNT_ROOT)
const issue = await linear.getIssue(issueId);
await linear.comment(issueId, ':rocket: done');

await githubClient().mergePullRequest({ owner, repo, number });
await slackClient().post('#eng', 'shipped');
```

## Create delivery status

GitHub and Linear create helpers return a discriminated `CreatedResult` instead
of making a missing receipt look confirmed:

```ts
const posted = await githubClient().comment({ owner, repo, number }, body);

switch (posted.status) {
  case 'confirmed':
    console.log('provider receipt received', posted.id, posted.url);
    break;
  case 'pending':
    // The draft was accepted and may still be delivered. Do not throw/retry:
    // doing so can duplicate the provider-side effect.
    console.log('write accepted; receipt not observed yet', posted.path);
    break;
  case 'dropped':
    console.error('transport confirmed the write was dropped', posted.path);
    break;
}
```

`path` is always the Relayfile draft handle. For compatibility, `id` also
falls back to that path until a provider receipt supplies an id. `url` is an
empty string when no provider URL exists; it is never populated with a
filesystem path. Older custom transports need no changes: a receipt implies
`confirmed`, while no receipt implies `pending`. A transport should report
`dropped` only with positive evidence that the draft will not be handled.
Mount receipt timeouts and direct-HTTP operations that are still running are
therefore `pending`; a direct operation explicitly reported as failed,
dead-lettered, or canceled is `dropped`. Ambiguous failures such as an admission
timeout still throw because the server may have accepted the request before the
client lost the response—calling that dropped would make an unsafe retry look
safe. A missing receipt alone can never distinguish pending from an unmounted
draft, so callers must not promote `pending` to `dropped` themselves.

## A named client for every provider

Every provider in the catalog has a named client (`asanaClient`, `notionClient`,
`jiraClient`, … — all 29), exposing its resources as
`.{resource}.{path,write,read,list}`:

```ts
import { notionClient } from '@relayfile/relay-helpers';

const notion = notionClient();
notion.pages.path({ databaseId });                  // resolve a path (no IO)
await notion.pages.write({ databaseId }, { /* … */ }); // collection create or item write
await notion.pages.list({ databaseId });               // list a collection
```

- `write(params, body)` drops a uniquely-named draft for a collection resource,
  or writes directly to an item resource (a path ending in `.json`). The
  Relayfile writeback worker turns the draft into the real provider call.
- `read` / `list` operate over the catalog paths.
- Unknown providers/resources or missing path params throw loudly — never a
  guessed path.

`linearClient` / `githubClient` / `slackClient` are the same resource-keyed
clients **plus** named ergonomic methods (`comment`, `post`, `mergePullRequest`,
…). `relayClient(provider)` is the dynamic, string-keyed escape hatch when the
provider isn't known at author time.

## Side-effect-free previews

Inject `PreviewTransport` when a local run must record intended provider
operations without touching a Relayfile mount or network API. Explicit
transport injection normally wins over ambient credentials:

```ts
import { PreviewTransport, slackClient } from '@relayfile/relay-helpers';

const preview = new PreviewTransport();
const slack = slackClient({ transport: preview });
const header = await slack.post('C123', 'Daily digest');
await slack.post('C123', 'First item', { replyTo: header.ref });

console.log(preview.actions); // typed read/list/write TransportPreviewAction records
```

Simulated receipts use deterministic fake IDs, so later operations can refer
to earlier previewed writes. Seed reads and lists by canonical path through the
constructor's `fixtures` option or `preview.seed(path, value)`.

For existing handlers that call `slackClient()` (or another client factory)
without options, bind the preview for the process and restore it after the run:

```ts
import { PreviewTransport, bindPreviewTransport } from '@relayfile/relay-helpers/transport';

const preview = new PreviewTransport();
const restore = bindPreviewTransport(preview);
try {
  await handler();
} finally {
  restore();
}
```

Local runtimes that enforce an immutable write policy can bind a final-write
authorizer. It runs after explicit/process transport selection, so authored
`transport` options cannot bypass denial or canonical preview routing:

```ts
import {
  PreviewTransport,
  bindRelayWriteAuthorizer,
  runWithRelayWriteAuthorizer,
} from '@relayfile/relay-helpers/transport';

const canonicalPreview = new PreviewTransport();
const restoreAuthorization = bindRelayWriteAuthorizer(() => ({
  allowed: true,
  transport: canonicalPreview,
}));
try {
  await handler();
} finally {
  restoreAuthorization();
}
```

Returning `{ allowed: false }` rejects before any selected transport or native
VFS write. Authorizers compose from outermost to innermost: any denial wins,
and the first transport override remains authoritative, so Agent code cannot
relax a runtime denial or redirect its canonical preview. Reads and lists are
unaffected. Cleanup callbacks are idempotent and safe out of order, but should
still be restored in `finally`.

When one process can host overlapping Runs, use an isolated async scope rather
than an imperative binding. Bindings created by code inside the operation still
compose with the outer policy:

```ts
await runWithRelayWriteAuthorizer(
  () => ({ allowed: true, transport: canonicalPreview }),
  async () => {
    await importAndRunAgent();
  },
);
```

The execution coordinator is shared across installed package copies and its
global reference cannot be overwritten or deleted. This lets the runtime bind
before importing authored code without exposing last-writer-wins policy state.
