import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The nango-integrations persona spec. The persona builds and maintains Nango
 * TypeScript integrations and their Cloud-side Relayfile wiring.
 *
 * Source of truth: `persona.json` in this package. Consumers (cloud, nightcto)
 * serialize this object to their on-disk persona.json via a checked-in generate
 * script with a drift check.
 *
 * Loaded via createRequire so it works on every supported Node version without
 * relying on JSON import attributes.
 */
const persona = require('./persona.json');

export const nangoIntegrationsPersona = persona;

export default persona;
