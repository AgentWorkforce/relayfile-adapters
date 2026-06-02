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

// `persona` is the full spec object (the operations manual is on
// `persona.agentsMdContent`). Serialize it to your on-disk persona.json — see
// the generate scripts in cloud / nightcto.
import { writeFileSync } from 'node:fs';
writeFileSync('persona.json', JSON.stringify(persona, null, 2) + '\n');
```

The raw spec is also available directly:

```ts
import persona from '@agentworkforce/persona-nango-integrations/persona.json' with { type: 'json' };
```

## Source of truth

`persona.json` is the single source of truth — a plain-data spec, no build step.
`index.js` just loads and re-exports it. To change the persona, edit
`persona.json` and bump the version.

## Publishing

Published under the `@agentworkforce` scope via the dedicated
`.github/workflows/publish-persona.yml` workflow (separate from the
`@relayfile/*` `publish.yml`), using npm `--provenance` (OIDC trusted
publishing) — same structure as `publish.yml`.
