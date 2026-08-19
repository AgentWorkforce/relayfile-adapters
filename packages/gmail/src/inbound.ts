import {
  defineInboundCapabilities,
  defineNangoInboundCapability,
} from "@relayfile/adapter-core/inbound";

import {
  GMAIL_PATH_ROOT,
  GMAIL_PROVIDER_CONFIG_ALIASES,
  GMAIL_PROVIDER_ID,
} from "./identity.js";

export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "gmail.nango",
    providerId: GMAIL_PROVIDER_ID,
    pathRoot: GMAIL_PATH_ROOT,
    providerConfigAliases: GMAIL_PROVIDER_CONFIG_ALIASES,
  }),
]);
