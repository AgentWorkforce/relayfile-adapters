# `new.json` Caller Scan

Scan date: 2026-05-09.

The migration target is to remove caller and documentation guidance that writes to reserved `new.json` paths. Adapter resolver internals and their focused tests are owned by `adapter-implementation-4faa1ff9`; this report lists them separately so reviewers can verify that the remaining matches are implementation-owned.

## Migrated Cloud worktree callers

Worktree: `../cloud-issue45-file-native-writeback`.

| File | Previous path | Migration |
|---|---|---|
| `packages/relayfile/src/writeback/provider-executor.ts` | `/linear/issues/new.json`, `/linear/issues/<id>/comments/new.json`, `/slack/channels/<channel>/messages/new.json`, `/slack/channels/<channel>/messages/<msg>/{replies,reactions}/new.json` | Updated supported-path comments and allowlist regexes to non-canonical draft filenames under the same resource directories. |
| `packages/relayfile/test/provider-writeback-executor.test.ts` | `/linear/issues/new.json`, `/slack/channels/customer-success/messages/new.json` | Updated queue consumer examples to `/linear/issues/create request.json` and `/slack/channels/customer-success/messages/create request.json`. |
| `tests/relayfile-writeback-bridge.test.ts` | Slack and Linear bridge examples using `new.json` | Updated Slack messages to `create request.json`, Slack reactions to `add reaction.json`, and Linear creates to `create request.json`. |
| `nango-integrations/INTEGRATION_SCOPES.md` | Slack scope note mentions `/messages/new.json` and `/reactions/new.json` | Updated the scope note to generic `/messages/<draft>.json` and `/reactions/<draft>.json` paths. |

## Migrated out-of-tree demo callers

Worktree: `../demos/cortical-demo`.

| File | Previous path | Migration |
|---|---|---|
| `prompts/linear-issuer.md` | `/linear/issues/new.json`; instructions to ignore `new.json` when finding the created issue | Update the prompt to write `/linear/issues/create request.json` and stop treating `new.json` as a special sibling file. |
| `scripts/orchestrator.ts` | `/slack/channels/${SLACK_CHANNEL_ID}/messages/new.json` | Update the agent task to write a non-canonical Slack draft file. |

## Cloud base repo findings

The base `../cloud` repo still contains the same `new.json` matches as the created migration worktree had before this change. Do not patch `../cloud` directly; verify `../cloud-issue45-file-native-writeback` instead.

## Verification status

The owned Cloud migration files now have zero `new.json` matches:

```bash
rg -n "new\.json|/new\.json" ../cloud-issue45-file-native-writeback
```

Result: no matches.

The cortical-demo caller files now have zero `new.json` matches:

```bash
rg -n "new\.json" ../demos/cortical-demo/prompts/linear-issuer.md ../demos/cortical-demo/scripts/orchestrator.ts
```

Targeted checks run:

- `npm run test:writeback-discovery` in `../relayfile-adapters-issue45-rollout`: passed, `Verified 43 writeback discovery endpoints.`
- `npm run build:core` in `../cloud-issue45-file-native-writeback`: passed.
- `npx vitest run --config packages/relayfile/vitest.config.ts packages/relayfile/test/provider-writeback-executor.test.ts`: passed, 9 tests.
- `npx tsx --test tests/relayfile-writeback-bridge.test.ts`: failed 5 tests because the Cloud worktree still imports the currently published adapter packages. Those packages have not yet been bumped or linked to the issue-45 file-native adapter ports, so Slack draft paths return `No Slack writeback rule matched ...` and Linear draft paths are interpreted as `update_issue` rather than `create_issue`. This is expected until Cloud consumes adapter packages that include the file-native resolver changes; no compatibility shim was added.

## Adapter repo implementation-owned findings

Worktree: `../relayfile-adapters-issue45-rollout`.

The following matches are expected until `adapter-implementation-4faa1ff9` ports the adapter resolvers and focused tests:

- `packages/{asana,clickup,gitlab,hubspot,intercom,jira,notion,pipedrive,salesforce,slack,teams,zendesk}/src/writeback.ts`
- `packages/{asana,clickup,gitlab,notion,salesforce,shopify,slack,teams}/**/*test.ts`
- `scripts/writeback-discovery-data.mjs`

The discovery generator now uses `create request.json` as the non-canonical example. `scripts/writeback-discovery-data.mjs` may still contain provider endpoint descriptors with `new.json`; those strings are discovery-only labels for existing operation descriptions, not runtime contracts and not a compatibility shim.

Additional adapter packages with `new.json` writeback routes outside the issue-45 writable discovery set were found in `packages/{calendly,mailgun,mixpanel,segment,sendgrid,shopify,stripe}/src/writeback.ts`. These are not in the lead's 13-adapter port list for this step and should be tracked as follow-up scope if they are intended to participate in file-native writeback.
