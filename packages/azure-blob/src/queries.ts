export const providerQueries = {
  provider: "azure-blob",
  providerConfigKey: "azure-storage",
  nangoFallbackSyncName: null,
  scopes: [
  "https://storage.azure.com/user_impersonation"
],
  syncs: [],
  actions: {
    objectWrite: "/{container}/{name}",
    lifecycleWrite: "/eventSubscriptions/{id}",
  },
} as const;
