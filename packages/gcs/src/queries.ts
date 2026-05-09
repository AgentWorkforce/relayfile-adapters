export const providerQueries = {
  provider: "gcs",
  providerConfigKey: "google",
  nangoFallbackSyncName: null,
  scopes: [
  "https://www.googleapis.com/auth/devstorage.read_write"
],
  syncs: [],
  actions: {
    objectWrite: "/storage/v1/b/{bucket}/o/{name}",
    lifecycleWrite: "/storage/v1/b/{bucket}/notificationConfigs",
  },
} as const;
