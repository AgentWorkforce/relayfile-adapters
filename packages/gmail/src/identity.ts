/**
 * Canonical Gmail identity for all Relayfile consumers.
 *
 * `google-mail` remains a read/digest compatibility identity while existing
 * Cloud mounts are resynced. New materialization must write only under
 * `GMAIL_PATH_ROOT`.
 */
export const GMAIL_PROVIDER_ID = "gmail" as const;
export const GMAIL_PATH_ROOT = "/gmail" as const;
export const GMAIL_LEGACY_PROVIDER_IDS = ["google-mail"] as const;
export const GMAIL_LEGACY_PATH_ROOTS = ["/google-mail"] as const;
export const GMAIL_PATH_ROOTS = [
  GMAIL_PATH_ROOT,
  ...GMAIL_LEGACY_PATH_ROOTS,
] as const;
export const GMAIL_PROVIDER_CONFIG_ALIASES = [
  "gmail",
  "google-mail",
  "google-mail-relay",
] as const;

export const GMAIL_IDENTITY = {
  schema: "relayfile.provider-identity/1",
  providerId: GMAIL_PROVIDER_ID,
  pathRoot: GMAIL_PATH_ROOT,
  providerConfigAliases: GMAIL_PROVIDER_CONFIG_ALIASES,
  legacyProviderIds: GMAIL_LEGACY_PROVIDER_IDS,
  legacyPathRoots: GMAIL_LEGACY_PATH_ROOTS,
  migration: {
    canonicalWrites: "canonical-only",
    legacyReads: "supported",
    legacyDigests: "supported",
    legacyDeletion: "forbidden",
    resync: "required",
    retireLegacyAfter: "zero-references-and-explicit-cutover",
  },
} as const;

export function isGmailProvider(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === GMAIL_PROVIDER_ID ||
    GMAIL_LEGACY_PROVIDER_IDS.some((alias) => alias === normalized) ||
    GMAIL_PROVIDER_CONFIG_ALIASES.some((alias) => alias === normalized)
  );
}

export function isGmailPath(path: string): boolean {
  const normalized = `/${path.trim().replace(/^\/+/u, "")}`.replace(
    /\/+$/u,
    "",
  );
  return GMAIL_PATH_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}
