import {
  defineHookdeckInboundCapability,
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

const GITLAB_PROVIDER_CONFIG_ALIASES = ["gitlab", "gitlab-relay"] as const;

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "gitlab.nango",
    providerId: "gitlab",
    pathRoot: "/gitlab",
    providerConfigAliases: GITLAB_PROVIDER_CONFIG_ALIASES,
  }),
  defineHookdeckInboundCapability({
    id: "gitlab.hookdeck",
    providerId: "gitlab",
    pathRoot: "/gitlab",
    providerConfigAliases: GITLAB_PROVIDER_CONFIG_ALIASES,
    detectionHeaders: [
      "x-gitlab-event",
      "x-gitlab-event-uuid",
      "x-gitlab-token",
    ],
    providerDeliveryIdHeaders: ["x-gitlab-event-uuid"],
    hookdeckDeliveryIdHeaders: ["x-hookdeck-eventid"],
  }),
]);
