import persona from './persona.generated.js';

/**
 * The fully-assembled nango-integrations persona spec, with the operations
 * manual (`AGENTS.md`) inlined as `agentsMdContent`.
 *
 * Source of truth: `persona.base.json` + `AGENTS.md` in this package.
 * Consumers (cloud, nightcto) serialize this object to their on-disk
 * `persona.json` via a checked-in generate script with a drift check.
 */
export const nangoIntegrationsPersona = persona;

export type NangoIntegrationsPersona = typeof persona;

export default persona;
