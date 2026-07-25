import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "linear.nango",
    providerId: "linear",
    pathRoot: "/linear",
    providerConfigAliases: ["linear", "linear-relay", "linear-sage"],
  }),
]);
