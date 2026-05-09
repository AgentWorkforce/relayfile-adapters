export const providerQueries = {
  provider: "onedrive",
  providerConfigKey: "one-drive",
  nangoFallbackSyncName: "onedrive-files",
  scopes: [
  "Files.ReadWrite.All",
  "offline_access"
],
  syncs: [
  {
    "name": "onedrive-files",
    "models": [
      "items"
    ]
  }
],
  actions: {
    objectWrite: "/v1.0/me/drive/items/{itemId}",
    lifecycleWrite: "/v1.0/subscriptions",
  },
} as const;
