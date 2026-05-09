export const providerQueries = {
  provider: "google-drive",
  providerConfigKey: "google-drive",
  nangoFallbackSyncName: "google-drive-files",
  scopes: [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive"
],
  syncs: [
  {
    "name": "google-drive-files",
    "models": [
      "files"
    ]
  }
],
  actions: {
    objectWrite: "/drive/v3/files",
    lifecycleWrite: "/drive/v3/files/{resourceId}/watch",
  },
} as const;
