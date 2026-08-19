import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "github.nango",
    providerId: "github",
    pathRoot: "/github",
    providerConfigAliases: [
      "github",
      "github-app",
      "github-app-oauth",
      "github-relay",
      "github-sage",
    ],
  }),
]);
