import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";

import {
  composeProjectScopedId,
  computePostHogPath,
  posthogAggregateCollection,
  posthogAggregateIndexPath,
  posthogDashboardByNameAliasPath,
  posthogExperimentByNameAliasPath,
  posthogFeatureFlagByKeyAliasPath,
  posthogGlobalByIdAliasPath,
  posthogInsightByShortIdAliasPath,
  posthogProjectByIdAliasPath,
  posthogProjectByNameAliasPath,
  posthogProjectLocalByIdAliasPath,
  posthogProjectLocalIndexPath,
  posthogProjectsIndexPath,
  posthogRecordDisplayName,
  posthogRootIndexPath,
  posthogSurveyByNameAliasPath,
} from "./path-mapper.js";
import { type PostHogPathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;
const EMIT_CONCURRENCY = 8;

type PostHogRecord = Record<string, unknown> & {
  id?: string | number;
  project_id?: string | number;
  projectId?: string | number;
  alert_id?: string | number;
  project_name?: string;
  name?: string;
  title?: string;
  short_id?: string;
  key?: string;
  state?: string;
  status?: string;
  active?: boolean;
  archived?: boolean;
  deleted?: boolean;
  occurred_at?: string;
  updated_at?: string;
  updatedAt?: string;
  created_at?: string;
  createdAt?: string;
  last_modified_at?: string;
  last_called_at?: string;
  start_date?: string;
  timestamp?: string;
  _deleted?: true;
};

type IndexRow = {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
} & Record<string, unknown>;

type ProjectScopedObjectType = Exclude<PostHogPathObjectType, "project">;

type IndexSnapshot = {
  rows: IndexRow[];
  available: boolean;
};

type JsonReadResult =
  | { available: true; value: unknown }
  | { available: false; value: null };

export interface EmitPostHogAuxiliaryFilesInput {
  workspaceId: string;
  projects?: readonly PostHogRecord[];
  insights?: readonly PostHogRecord[];
  dashboards?: readonly PostHogRecord[];
  featureFlags?: readonly PostHogRecord[];
  annotations?: readonly PostHogRecord[];
  experiments?: readonly PostHogRecord[];
  surveys?: readonly PostHogRecord[];
  alertEvents?: readonly PostHogRecord[];
  connectionId?: string;
}

export async function emitPostHogAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitPostHogAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await safeWrite(
    client,
    input.workspaceId,
    posthogRootIndexPath(),
    `${JSON.stringify(
      [
        { id: "projects", title: "Projects", canonicalPath: posthogProjectsIndexPath() },
        { id: "insights", title: "Insights", canonicalPath: posthogAggregateIndexPath("insights") },
        { id: "dashboards", title: "Dashboards", canonicalPath: posthogAggregateIndexPath("dashboards") },
        { id: "feature-flags", title: "Feature Flags", canonicalPath: posthogAggregateIndexPath("feature-flags") },
        { id: "annotations", title: "Annotations", canonicalPath: posthogAggregateIndexPath("annotations") },
        { id: "experiments", title: "Experiments", canonicalPath: posthogAggregateIndexPath("experiments") },
        { id: "surveys", title: "Surveys", canonicalPath: posthogAggregateIndexPath("surveys") },
        { id: "alert-events", title: "Alert Events", canonicalPath: posthogAggregateIndexPath("alert-events") },
      ],
      null,
      2,
    )}\n`,
    aggregate,
  );

  await emitProjects(client, input.workspaceId, input.projects ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "insight", input.insights ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "dashboard", input.dashboards ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "feature-flag", input.featureFlags ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "annotation", input.annotations ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "experiment", input.experiments ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "survey", input.surveys ?? [], aggregate, input.connectionId);
  await emitProjectScopedCollection(client, input.workspaceId, "alert-event", input.alertEvents ?? [], aggregate, input.connectionId);

  return aggregate;
}

async function emitProjects(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly PostHogRecord[],
  aggregate: EmitAuxiliaryFilesResult,
  connectionId: string | undefined,
): Promise<void> {
  const indexPath = posthogProjectsIndexPath();
  const existing = await readIndex(client, workspaceId, indexPath, aggregate);
  const rows = new Map(existing.rows.map((row) => [row.id, row]));

  await runWithConcurrencyLimit(records, EMIT_CONCURRENCY, async (record) => {
    const projectId = readProjectId(record, "project");
    if (!projectId) {
      return;
    }

    const byIdPath = posthogProjectByIdAliasPath(projectId);
    const previousRecord = await readAliasRecord(client, workspaceId, byIdPath, aggregate);
    const previousName = readString(previousRecord?.name) ?? readString(previousRecord?.project_name);
    const currentName = readProjectTitle(record, projectId);
    const canonicalPath = computePostHogPath("project", projectId);
    const byNamePath = posthogProjectByNameAliasPath(currentName, projectId);

    if (record._deleted === true) {
      rows.delete(projectId);
      await safeDelete(client, workspaceId, byIdPath, aggregate);
      if (previousName) {
        await safeDelete(
          client,
          workspaceId,
          posthogProjectByNameAliasPath(previousName, projectId),
          aggregate,
        );
      }
      return;
    }

    const previousRow = rows.get(projectId);
    rows.set(projectId, {
      id: projectId,
      title: currentName,
      updated: readUpdated(record, previousRow?.updated),
      canonicalPath,
      organization_id: readIdentifier(record.organization_id),
      archived: record.archived === true,
    });

    const aliasPayload = buildAliasPayload({
      provider: "posthog",
      objectType: "project",
      objectId: projectId,
      canonicalPath,
      payload: record,
      ...(connectionId ? { connectionId } : {}),
    });

    await safeWrite(
      client,
      workspaceId,
      byIdPath,
      `${JSON.stringify(aliasPayload, null, 2)}\n`,
      aggregate,
    );
    await safeWrite(
      client,
      workspaceId,
      byNamePath,
      `${JSON.stringify(aliasPayload, null, 2)}\n`,
      aggregate,
    );

    if (previousName && previousName !== currentName) {
      await safeDelete(
        client,
        workspaceId,
        posthogProjectByNameAliasPath(previousName, projectId),
        aggregate,
      );
    }
  });

  if (existing.available) {
    await writeSortedIndex(client, workspaceId, indexPath, rows, aggregate);
  }
}

async function emitProjectScopedCollection(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  objectType: ProjectScopedObjectType,
  records: readonly PostHogRecord[],
  aggregate: EmitAuxiliaryFilesResult,
  connectionId: string | undefined,
): Promise<void> {
  const aggregateIndexPath = posthogAggregateIndexPath(
    posthogAggregateCollection(objectType),
  );
  const aggregateExisting = await readIndex(
    client,
    workspaceId,
    aggregateIndexPath,
    aggregate,
  );
  const aggregateRows = new Map(
    aggregateExisting.rows.map((row) => [row.id, row]),
  );

  const grouped = groupByProject(records, objectType);
  for (const [projectId, projectRecords] of grouped.entries()) {
    const projectIndexPath = posthogProjectLocalIndexPath(objectType, projectId);
    const projectExisting = await readIndex(
      client,
      workspaceId,
      projectIndexPath,
      aggregate,
    );
    const projectRows = new Map(
      projectExisting.rows.map((row) => [row.id, row]),
    );

    await runWithConcurrencyLimit(
      projectRecords,
      EMIT_CONCURRENCY,
      async (record) => {
      const objectId = readObjectId(record, objectType);
      if (!objectId) {
        return;
      }

      const globalAliasPath = posthogGlobalByIdAliasPath(
        objectType,
        projectId,
        objectId,
      );
      const localAliasPath = posthogProjectLocalByIdAliasPath(
        objectType,
        projectId,
        objectId,
      );
      const previousRecord = await readAliasRecord(
        client,
        workspaceId,
        globalAliasPath,
        aggregate,
      );
      const title = posthogRecordDisplayName(
        objectType,
        record,
        objectId,
      );
      const canonicalPath = computePostHogPath(objectType, objectId, {
        projectId,
        displayName: title,
      });
      const previousCanonicalPath = previousRecord
        ? computePostHogPath(objectType, objectId, {
            projectId,
            displayName: posthogRecordDisplayName(
              objectType,
              previousRecord,
              objectId,
            ),
          })
        : null;
      const aggregateId = composeProjectScopedId(projectId, objectId);
      const aliasPayload = buildAliasPayload({
        provider: "posthog",
        objectType,
        objectId,
        canonicalPath,
        payload: record,
        ...(connectionId ? { connectionId } : {}),
        projectId,
      });

      if (record._deleted === true) {
        aggregateRows.delete(aggregateId);
        projectRows.delete(objectId);
        await safeDelete(client, workspaceId, globalAliasPath, aggregate);
        await safeDelete(client, workspaceId, localAliasPath, aggregate);
        for (const extraAlias of extraAliasPaths(
          objectType,
          projectId,
          previousRecord ?? record,
        )) {
          await safeDelete(client, workspaceId, extraAlias, aggregate);
        }
        if (previousCanonicalPath) {
          await safeDelete(
            client,
            workspaceId,
            previousCanonicalPath,
            aggregate,
          );
        }
        return;
      }

      const previousAggregateRow = aggregateRows.get(aggregateId);
      const previousProjectRow = projectRows.get(objectId);
      aggregateRows.set(aggregateId, {
        id: aggregateId,
        title,
        updated: readUpdated(record, previousAggregateRow?.updated),
        canonicalPath,
        project_id: projectId,
        project_name: readString(record.project_name),
        state: readString(record.state),
        status: readString(record.status),
        archived: record.archived === true,
      });
      projectRows.set(objectId, {
        id: objectId,
        title,
        updated: readUpdated(record, previousProjectRow?.updated),
        canonicalPath,
        state: readString(record.state),
        status: readString(record.status),
        archived: record.archived === true,
      });

      await safeWrite(
        client,
        workspaceId,
        globalAliasPath,
        `${JSON.stringify(aliasPayload, null, 2)}\n`,
        aggregate,
      );
      await safeWrite(
        client,
        workspaceId,
        localAliasPath,
        `${JSON.stringify(aliasPayload, null, 2)}\n`,
        aggregate,
      );

      const previousExtraAliases = new Set(
        extraAliasPaths(objectType, projectId, previousRecord),
      );
      const currentExtraAliases = new Set(
        extraAliasPaths(objectType, projectId, record),
      );
      for (const staleAlias of previousExtraAliases) {
        if (!currentExtraAliases.has(staleAlias)) {
          await safeDelete(client, workspaceId, staleAlias, aggregate);
        }
      }
      for (const aliasPath of currentExtraAliases) {
        await safeWrite(
          client,
          workspaceId,
          aliasPath,
          `${JSON.stringify(aliasPayload, null, 2)}\n`,
          aggregate,
        );
      }
      if (
        previousCanonicalPath &&
        previousCanonicalPath !== canonicalPath
      ) {
        await safeDelete(
          client,
          workspaceId,
          previousCanonicalPath,
          aggregate,
        );
      }
    },
    );

    if (projectExisting.available) {
      await writeSortedIndex(
        client,
        workspaceId,
        projectIndexPath,
        projectRows,
        aggregate,
      );
    }
  }

  if (aggregateExisting.available) {
    await writeSortedIndex(
      client,
      workspaceId,
      aggregateIndexPath,
      aggregateRows,
      aggregate,
    );
  }
}

function groupByProject(
  records: readonly PostHogRecord[],
  objectType: ProjectScopedObjectType,
): Map<string, PostHogRecord[]> {
  const grouped = new Map<string, PostHogRecord[]>();
  for (const record of records) {
    const projectId = readProjectId(record, objectType);
    if (!projectId) {
      continue;
    }
    if (!grouped.has(projectId)) {
      grouped.set(projectId, []);
    }
    grouped.get(projectId)?.push(record);
  }
  return grouped;
}

function readProjectId(
  record: PostHogRecord,
  objectType: PostHogPathObjectType,
): string | undefined {
  if (objectType === "project") {
    return readIdentifier(record.project_id) ?? readIdentifier(record.id);
  }
  return readIdentifier(record.project_id) ?? readIdentifier(record.projectId);
}

function readObjectId(
  record: PostHogRecord,
  objectType: ProjectScopedObjectType,
): string | undefined {
  if (objectType === "alert-event") {
    return readIdentifier(record.id) ?? readIdentifier(record.alert_id);
  }
  return readIdentifier(record.id);
}

function readProjectTitle(record: PostHogRecord, projectId: string): string {
  return (
    readString(record.name) ??
    readString(record.project_name) ??
    readString(record.slug) ??
    projectId
  );
}

function extraAliasPaths(
  objectType: ProjectScopedObjectType,
  projectId: string,
  record: PostHogRecord | null | undefined,
): string[] {
  if (!record) {
    return [];
  }
  switch (objectType) {
    case "insight": {
      const shortId = readString(record.short_id);
      return shortId ? [posthogInsightByShortIdAliasPath(projectId, shortId)] : [];
    }
    case "feature-flag": {
      const key = readString(record.key);
      return key ? [posthogFeatureFlagByKeyAliasPath(projectId, key)] : [];
    }
    case "dashboard": {
      const name = readString(record.name);
      const id = readObjectId(record, objectType);
      return name && id
        ? [posthogDashboardByNameAliasPath(projectId, name, id)]
        : [];
    }
    case "experiment": {
      const name = readString(record.name);
      const id = readObjectId(record, objectType);
      return name && id
        ? [posthogExperimentByNameAliasPath(projectId, name, id)]
        : [];
    }
    case "survey": {
      const name = readString(record.name);
      const id = readObjectId(record, objectType);
      return name && id
        ? [posthogSurveyByNameAliasPath(projectId, name, id)]
        : [];
    }
    default:
      return [];
  }
}

function readUpdated(
  record: PostHogRecord,
  previousUpdated: string | undefined,
): string {
  return (
    readString(record.updated_at) ??
    readString(record.updatedAt) ??
    readString(record.modified_at) ??
    readString(record.last_modified_at) ??
    readString(record.last_called_at) ??
    readString(record.occurred_at) ??
    readString(record.timestamp) ??
    readString(record.start_date) ??
    readString(record.created_at) ??
    readString(record.createdAt) ??
    previousUpdated ??
    ""
  );
}

function buildAliasPayload(input: {
  provider: "posthog";
  objectType: PostHogPathObjectType;
  objectId: string;
  canonicalPath: string;
  payload: PostHogRecord;
  connectionId?: string;
  projectId?: string;
}): Record<string, unknown> {
  return {
    provider: input.provider,
    objectType: input.objectType,
    objectId: input.objectId,
    canonicalPath: input.canonicalPath,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    payload: input.payload,
  };
}

async function writeSortedIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  rows: Map<string, IndexRow>,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  await safeWrite(
    client,
    workspaceId,
    path,
    `${JSON.stringify(
      Array.from(rows.values()).sort((left, right) =>
        String(right.updated).localeCompare(String(left.updated)),
      ),
      null,
      2,
    )}\n`,
    aggregate,
  );
}

async function readIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<IndexSnapshot> {
  const result = await safeReadJson(client, workspaceId, path, aggregate);
  return {
    available: result.available,
    rows:
      result.available && Array.isArray(result.value)
        ? (result.value as IndexRow[])
        : [],
  };
}

async function readAliasRecord(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<PostHogRecord | null> {
  const result = await safeReadJson(client, workspaceId, path, aggregate);
  if (!result.available || !isRecord(result.value)) {
    return null;
  }
  const payload = isRecord(result.value.payload)
    ? result.value.payload
    : result.value;
  return payload as PostHogRecord;
}

async function safeReadJson(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<JsonReadResult> {
  if (!client.readFile) {
    return { available: false, value: null };
  }
  try {
    const value = await client.readFile({ workspaceId, path });
    const content =
      typeof value === "string"
        ? value
        : value && typeof value.content === "string"
          ? value.content
          : null;
    if (!content) {
      return { available: true, value: null };
    }
    return { available: true, value: JSON.parse(content) as unknown };
  } catch (error) {
    const message = String(error);
    if (
      message.includes("not found") ||
      message.includes("ENOENT") ||
      message.includes("404")
    ) {
      return { available: true, value: null };
    }
    aggregate.errors.push({ path, error: message });
    return { available: false, value: null };
  }
}

async function safeWrite(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  content: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  try {
    await client.writeFile({
      workspaceId,
      path,
      content,
      contentType: JSON_CONTENT_TYPE,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: String(error) });
  }
}

async function safeDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (!client.deleteFile) {
    aggregate.errors.push({ path, error: "deleteFile not supported by client" });
    return;
  }
  try {
    await client.deleteFile({ workspaceId, path });
    aggregate.deleted += 1;
  } catch (error) {
    const message = String(error);
    if (
      message.includes("not found") ||
      message.includes("ENOENT") ||
      message.includes("404")
    ) {
      return;
    }
    aggregate.errors.push({ path, error: message });
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  const text = readString(value);
  if (text) {
    return text;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

async function runWithConcurrencyLimit<T>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), values.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex];
        nextIndex += 1;
        if (value !== undefined) {
          await worker(value);
        }
      }
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
