import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "notion.nango",
    providerId: "notion",
    pathRoot: "/notion",
    providerConfigAliases: ["notion", "notion-relay", "notion-sage"],
  }),
]);
