# Working in relayfile-adapters

```sh
npm ci
npx turbo build typecheck test
npm run test:writeback-discovery
npm run test:digest-contracts
```

- Adapters own typed path helpers, meaningful provider LAYOUT (at least ~1000 bytes), indexes, aliases and trigger/scope-key/writeback/inbound catalogs. Consumers import these contracts; no copied local declarations.
- Use shared slugifyAlias/aliasCollisionSuffix; stable provider IDs are unchanged. Flat records use slug__id.json; records with children use id__slug/meta.json, never legacy metadata.json.
- Keep indexes newest-first and aliases deterministic/consistent. Preserve additive path compatibility and coordinate published consumer bumps/resyncs; feature PRs never bump package versions.
- Build before catalog generation. Regenerate triggers, scope-keys, writeback-paths, inbound and relay-helpers clients after contract changes; see `docs/agent-reference.md` for exact commands.
- Writebacks require full record schemas, create examples and .adapter.md; create via a noncanonical filename, not magic new.json. Regenerate discovery and update docs/writeback-spec-coverage.md.
- Read `.claude/rules/{naming-conventions,alias-subtrees,layout-md,generated-adapter-paths,adapter-writeback-discovery,relayfile-integration-digests,testing,versioning}.md` when changing those contracts.
## Relayfile Integration Digest Contract

- Terminal state is not deletion. Keep digest aliases aligned with the category matrix in `docs/digest-layout-contract.md`, using a consistent pointer or materialized canonical mirror per resource. Use shared generic rendering, run `npm run test:digest-contracts`, and curate root Unreleased.

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
