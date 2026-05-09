export const providerQueries = {
  provider: "postgres",
  providerConfigKey: "postgres",
  nangoFallbackSyncName: null,
  scopes: [
  "LISTEN",
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE"
],
  syncs: [],
  actions: {
    objectWrite: "parameterized INSERT/UPDATE/DELETE",
    lifecycleWrite: "LISTEN {channel}",
  },
} as const;
