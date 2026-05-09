export const providerQueries = {
  provider: "box",
  providerConfigKey: "box",
  nangoFallbackSyncName: "box-files",
  scopes: [
  "root_readwrite"
],
  syncs: [
  {
    "name": "box-files",
    "models": [
      "files"
    ]
  }
],
  actions: {
    objectWrite: "/2.0/files/content",
    lifecycleWrite: "/2.0/webhooks",
  },
} as const;
