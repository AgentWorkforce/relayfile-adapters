export const providerQueries = {
  provider: "s3",
  providerConfigKey: "aws-iam",
  nangoFallbackSyncName: null,
  scopes: [
  "s3:GetObject",
  "s3:PutObject",
  "s3:DeleteObject",
  "sqs:ReceiveMessage"
],
  syncs: [],
  actions: {
    objectWrite: "s3:PutObject",
    lifecycleWrite: "sqs:ReceiveMessage",
  },
} as const;
