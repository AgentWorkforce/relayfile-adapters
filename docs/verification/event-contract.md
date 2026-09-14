# Event contract verification

Working tree based on adapter main `0ce581f5`. Package versions are unchanged.

## Repository gate

Command (from repository root, with local test-server access):

```sh
PATH="/tmp/flows-ci-toolchain/node_modules/.bin:$PATH" npm_config_cache=/tmp/relayfile-event-npm-cache npx turbo build typecheck test > /tmp/relayfile-event-gate.log 2>&1
```

Exit code: 0. Full captured output is retained locally at
`/tmp/relayfile-event-gate.log` (16,086 lines). The final output excerpt is:

```text

 Tasks:    157 successful, 157 total
Cached:    0 cached, 157 total
  Time:    39.36s 

```

This includes the new public-export tests, existing adapter tests and catalog
checks. The new tests cover every catalog event, serialized declarations,
immutable snapshots, required provenance, identity preservation, concrete paths,
and finite acyclic JSON. TypeScript compilation also checks provider/event
mismatch examples. No test gate or existing test was modified.

## Packed consumer and browser bundle

Commands:

```sh
mkdir -p /tmp/relayfile-event-pack
PATH="/tmp/flows-ci-toolchain/node_modules/.bin:$PATH" npm pack --workspace @relayfile/adapter-core --ignore-scripts --pack-destination /tmp/relayfile-event-pack --json > /tmp/relayfile-event-pack.json
./node_modules/.bin/esbuild packages/core/src/events/index.ts --bundle --platform=browser --format=esm --outfile=/tmp/relayfile-event-pack/events.browser.mjs
```

Exit code: 0. Captured bundler output:

```text
  ../../../tmp/relayfile-event-pack/events.browser.mjs  20.5kb

⚡ Done in 14ms
```

The tarball was unpacked as the sole package in a fresh consumer's node_modules:

```sh
mkdir -p /tmp/relayfile-event-consumer/node_modules/@relayfile/adapter-core
tar -xzf /tmp/relayfile-event-pack/relayfile-adapter-core-0.5.24.tgz -C /tmp/relayfile-event-consumer/node_modules/@relayfile/adapter-core --strip-components=1
cp /tmp/relayfile-event-pack/events.browser.mjs /tmp/relayfile-event-consumer/events.browser.mjs
```

Exit code: 0; no output. The consumer script was:

```js
import assert from 'node:assert/strict';
import * as packed from '@relayfile/adapter-core/events';
import * as browser from './events.browser.mjs';

const input = {
  id: 'stable-upstream-event', provider: 'linear', eventType: 'issue.create',
  workspaceId: 'workspace', connectionId: 'connection',
  occurredAt: '2026-09-14T00:00:00.000Z',
  paths: ['/linear/issues/ENG-42__issue-42.json'], payload: { title: 'Example' },
};
const selector = { provider: 'linear', connectionId: 'connection', eventTypes: ['issue.create'] };
assert.deepEqual(packed.createAdapterEvent(input), browser.createAdapterEvent(input));
assert.deepEqual(packed.defineEventSubscription(selector), browser.defineEventSubscription(selector));
assert.equal(packed.parseAdapterEvent(JSON.parse(JSON.stringify(packed.createAdapterEvent(input)))).id, input.id);
assert.throws(() => packed.parseEventSubscription({ ...packed.defineEventSubscription(selector), labels: ['ready'] }));
console.log('Packed package export and browser bundle agree; serialized identity preserved; unsupported selectors rejected.');
```

Command:

```sh
node /tmp/relayfile-event-consumer/check.mjs
```

Captured output:

```text
Packed package export and browser bundle agree; serialized identity preserved; unsupported selectors rejected.
```

Exit code: 0. The bundled module was executed under Node for comparison; this is
not a browser UI test. No credentials, live provider events, subscription runtime,
Cloud deployment, or authored Flows handler bridge were exercised. Those consumer
changes follow the adapter-core release as described in `docs/event-subscriptions.md`.
