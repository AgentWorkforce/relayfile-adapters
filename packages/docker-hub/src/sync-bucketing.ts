import {
  mapToBucket,
  modelBucket,
  safeNormalize,
} from '@relayfile/adapter-core/sync-bucketing';

import {
  normalizeDockerHubObjectType,
  type DockerHubPathObjectType,
} from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeDockerHubObjectType),
  buckets: {
    repository: 'repositories',
    tag: 'tags',
    webhook: 'webhooks',
  },
  mapRecords(records, { modelType }) {
    return mapToBucket(records, dockerHubTombstone(modelType));
  },
});

function dockerHubTombstone(
  objectType: DockerHubPathObjectType,
): (id: string) => Record<string, unknown> {
  return (id: string) => ({ id, _deleted: true, objectType });
}
