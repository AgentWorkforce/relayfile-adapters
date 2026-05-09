export const providerQueries = {
  provider: "dropbox",
  providerConfigKey: "dropbox",
  nangoFallbackSyncName: "dropbox-files",
  scopes: [
  "files.metadata.read",
  "files.content.read",
  "files.content.write"
],
  syncs: [
  {
    "name": "dropbox-files",
    "models": [
      "files"
    ]
  }
],
  actions: {
    objectWrite: "/2/files/upload",
    lifecycleWrite: "/2/files/list_folder/continue",
  },
} as const;
