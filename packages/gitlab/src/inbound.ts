import {
  defineHookdeckInboundCapability,
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

/** Auth variants share one provider, event contract, and /gitlab tree. */
export const GITLAB_TOKEN_CONFIG_KEYS = ["gitlab-pat", "gitlab-group-token"] as const;
export const GITLAB_PROVIDER_CONFIG_ALIASES = [
  "gitlab", "gitlab-relay", ...GITLAB_TOKEN_CONFIG_KEYS,
] as const;

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
