import {
  defineHookdeckInboundCapability,
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from '@relayfile/adapter-core/inbound';

import {
  RAMP_HOOKDECK_DELIVERY_HEADER,
  RAMP_PROVIDER_CONFIG_ALIASES,
  RAMP_SIGNATURE_HEADER,
} from './types.js';

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: 'ramp.nango',
    providerId: 'ramp',
    pathRoot: '/ramp',
    providerConfigAliases: RAMP_PROVIDER_CONFIG_ALIASES,
  }),
  defineHookdeckInboundCapability({
    id: 'ramp.hookdeck',
    providerId: 'ramp',
    pathRoot: '/ramp',
    providerConfigAliases: RAMP_PROVIDER_CONFIG_ALIASES,
    detectionHeaders: [RAMP_SIGNATURE_HEADER],
    // Ramp does not provide a transport-level delivery header. Do not promote
    // the body `id` into providerDeliveryIdHeaders; Hookdeck delivery ids plus
    // semantic payload hashing are the correct contract here.
    hookdeckDeliveryIdHeaders: [RAMP_HOOKDECK_DELIVERY_HEADER],
  }),
]);
