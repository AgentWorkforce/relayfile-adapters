import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "slack.nango",
    providerId: "slack",
    pathRoot: "/slack",
    providerConfigAliases: [
      "slack",
      "slack-relay",
      "slack-sage",
      "slack-sage-preview",
    ],
  }),
]);
