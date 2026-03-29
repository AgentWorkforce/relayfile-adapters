import { GitLabApiClient } from '../api.js';
import { computeMetadataPath, computePipelineJobPath } from '../path-mapper.js';
import type { GitLabJob, GitLabPipeline, IngestOperation } from '../types.js';
import { mapJobStatusToOperationMode, mapPipelineStatusToOperationMode } from './job-mapper.js';

export async function ingestPipeline(
  api: GitLabApiClient,
  projectPath: string,
  pipelineId: number,
  mode?: IngestOperation['mode'],
): Promise<IngestOperation[]> {
  const projectId = api.projectId(projectPath);
  const [pipeline, jobs] = await Promise.all([
    api.get<GitLabPipeline>(`/api/v4/projects/${projectId}/pipelines/${pipelineId}`),
    api.get<GitLabJob[]>(`/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs`),
  ]);

  const pipelineMode = mode ?? mapPipelineStatusToOperationMode(pipeline.status);

  return [
    {
      path: computeMetadataPath(projectPath, 'pipelines', pipelineId),
      mode: pipelineMode,
      content: JSON.stringify(pipeline, null, 2),
      contentType: 'application/json',
    },
    ...jobs.map((job) => ({
      path: computePipelineJobPath(projectPath, pipelineId, job.id),
      mode: mapJobStatusToOperationMode(job.status),
      content: JSON.stringify(job, null, 2),
      contentType: 'application/json' as const,
    })),
  ];
}
