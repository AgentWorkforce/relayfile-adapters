# @agentworkforce/persona-nango-integrations

The canonical **nango-integrations** AgentWorkforce persona spec, published so
that both `cloud` and `nightcto` derive the same persona definition instead of
hand-maintaining divergent copies.

The persona builds and maintains Nango TypeScript integrations **and** their
Cloud-side Relayfile wiring (the `ADAPTERS` registry, webhook router, path
mapping, and digest tests) — an integration is not done until both sides land.

## Usage

```ts
import persona from '@agentworkforce/persona-nango-integrations';

// `persona` is the fully-assembled spec object, with the operations manual
// inlined as `persona.agentsMdContent`. Serialize it to your on-disk
// persona.json (see the generate scripts in cloud / nightcto).
import { writeFileSync } from 'node:fs';
writeFileSync('persona.json', JSON.stringify(persona, null, 2) + '\n');
```

## Sources of truth

This package is assembled from two human-editable files:

- `persona.base.json` — the persona metadata (id, intent, harness, model,
  skills, mcpServers, harnessSettings, …) — **everything except the manual**.
- `AGENTS.md` — the operations manual, inlined into the spec as
  `agentsMdContent`.

`npm run build` runs `scripts/assemble.mjs`, which regenerates the committed
`src/persona.generated.ts` from those two files, then compiles with `tsc`.
`npm test` runs `assemble.mjs --check`, which fails on drift — so the generated
artifact can never silently diverge from its sources.

Edit `persona.base.json` / `AGENTS.md`, never `src/persona.generated.ts`.

## Publishing

Published under the `@agentworkforce` scope via the dedicated
`.github/workflows/publish-persona.yml` workflow (not the `@relayfile/*`
`publish.yml`). It needs an `AGENTWORKFORCE_NPM_TOKEN` repo secret with publish
rights to the `@agentworkforce` scope.
