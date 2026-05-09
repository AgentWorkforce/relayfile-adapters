export const providerQueries = {
  provider: "sharepoint",
  providerConfigKey: "sharepoint-online",
  nangoFallbackSyncName: "sharepoint-online-files",
  scopes: [
  "Files.Read.All",
  "Files.ReadWrite.All",
  "offline_access"
],
  syncs: [
  {
    "name": "sharepoint-online-files",
    "models": [
      "items"
    ]
  }
],
  actions: {
    objectWrite: "/v1.0/sites/{siteId}/drives/{driveId}/items/{itemId}",
    lifecycleWrite: "/v1.0/subscriptions",
  },
} as const;
