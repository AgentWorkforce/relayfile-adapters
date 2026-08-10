import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "shortcut.nango",
    providerId: "shortcut",
    pathRoot: "/shortcut",
    providerConfigAliases: ["shortcut", "shortcut-relay"],
  }),
]);
