# Working in relay-helpers

- Every provider in `WRITEBACK_PATH_CATALOG` must expose a named providerClient export; keep the catalog/provider-client and generated-client sync checks green.
- Never hand-edit `src/generated/clients.ts`. Regenerate from the upstream catalog with `npm run gen -w @relayfile/relay-helpers`, then run `npm run test -w @relayfile/relay-helpers`.
- Bespoke providers belong in `BESPOKE_PROVIDERS`; enrich `providerClient(...)` with `Object.assign`. Avoid resource-name collisions: GitHub’s helper is `mergePullRequest`, not `merge`.
- Paths come from `writebackPath`, `relayClient` and `providerClient`, never provider literals. Correct upstream `resources.ts`, regenerate and update the dependency when a path is wrong.
- See [catalog coordination](../../docs/agent-reference.md#declared-catalogs-triggers-scope-keys-writeback-paths-and-inbound-capabilities) for upstream adapter obligations.

## Agency and guidance

- Act autonomously on routine assigned work; ask forgiveness rather than permission. Preserve explicit production, release and credential gates.
- For guidance, ask the engineering leads, the agent that spawned you, or the layered owner on Agent Relay.
- Only a truly pressing or blocking question goes to `khaliq-gant` or `will-washburn` on Agent Relay.

## Cross-repo context

- Before and during changes, understand how this repo fits the wider system; consult its repo map and related-repo docs where available.
- Check relevant agents’ summaries on Agent Relay and proactively contact owning agents about dependencies, adjacent changes and work in flight.

## Pull requests (when used)

- Open PRs as ready for review by default. If merging requires Khaliq’s OK, use `merge-train:hold` instead of draft status.
- If you open a PR, immediately subscribe to its feedback through Agent Relay using [this skill](https://github.com/AgentWorkforce/skills/blob/main/skills/subscribing-relay-webhooks-and-writebacks/SKILL.md), and verify subscription readiness.
- Evaluate each review finding. Address applicable feedback and explain declined changes in the thread.
- A PR is not ready while feedback remains unaddressed or merge conflicts remain.
- When ready, alert the CODEOWNERS and the agent that spawned you on Agent Relay.
- Keep related open PRs from going stale: find their authoring agent on Agent Relay and coordinate; if that agent is no longer on the relay, escalate to the CODEOWNERS or the layered owner.
