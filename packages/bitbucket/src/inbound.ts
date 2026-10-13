import {
  defineHookdeckInboundCapability,
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from '@relayfile/adapter-core/inbound';

const providerConfigAliases = ['bitbucket', 'bitbucket-relay'] as const;

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: 'bitbucket.nango',
    providerId: 'bitbucket',
    pathRoot: '/bitbucket',
    providerConfigAliases,
  }),
  defineHookdeckInboundCapability({
    id: 'bitbucket.hookdeck',
    providerId: 'bitbucket',
    pathRoot: '/bitbucket',
    providerConfigAliases,
    detectionHeaders: ['x-event-key', 'x-hub-signature'],
    providerDeliveryIdHeaders: ['x-request-uuid'],
    hookdeckDeliveryIdHeaders: ['x-hookdeck-eventid'],
  }),
]);
