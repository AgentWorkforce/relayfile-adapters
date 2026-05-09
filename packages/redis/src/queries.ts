export const providerQueries = {
  provider: "redis",
  providerConfigKey: "redis",
  nangoFallbackSyncName: null,
  scopes: [
  "GET",
  "SET",
  "HSET",
  "ZADD",
  "DEL",
  "PSUBSCRIBE"
],
  syncs: [],
  actions: {
    objectWrite: "SET/HSET/ZADD/DEL",
    lifecycleWrite: "PSUBSCRIBE __keyspace@{db}__:*",
  },
} as const;
