export const providerQueries = {
  provider: "gmail",
  providerConfigKey: "google-mail",
  nangoFallbackSyncName: "google-mail-emails",
  scopes: [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify"
],
  syncs: [
  {
    "name": "google-mail-emails",
    "models": [
      "threads"
    ]
  }
],
  actions: {
    objectWrite: "/gmail/v1/users/{account}/messages/{messageId}/modify",
    lifecycleWrite: "/gmail/v1/users/{account}/watch",
  },
} as const;
