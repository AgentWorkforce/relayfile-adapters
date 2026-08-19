import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "hubspot.nango",
    providerId: "hubspot",
    pathRoot: "/hubspot",
    providerConfigAliases: ["hubspot", "hubspot-relay"],
  }),
]);
