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
  posthogFeatureFlagByKeyAliasPath,
  posthogGlobalByIdAliasPath,
  posthogInsightByShortIdAliasPath,
  posthogProjectByIdAliasPath,
  posthogProjectByNameAliasPath,
  posthogProjectLocalByIdAliasPath,
  posthogProjectLocalIndexPath,
  posthogProjectsIndexPath,
  posthogRootIndexPath,
} from "./path-mapper.js";
import { type PostHogPathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type PostHogRecord = Record<string, unknown> & {
  id?: string;
  project_id?: string;
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
  const existingRows = await readIndex(client, workspaceId, indexPath, aggregate);
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  for (const record of records) {
    const projectId = readProjectId(record, "project");
    if (!projectId) {
      continue;
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
      continue;
    }

    rows.set(projectId, {
      id: projectId,
      title: currentName,
      updated: readUpdated(record),
      canonicalPath,
      organization_id: readString(record.organization_id),
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
  }

  await writeSortedIndex(client, workspaceId, indexPath, rows, aggregate);
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
  const aggregateExistingRows = await readIndex(
    client,
    workspaceId,
    aggregateIndexPath,
    aggregate,
  );
  const aggregateRows = new Map(aggregateExistingRows.map((row) => [row.id, row]));

  const grouped = groupByProject(records);
  for (const [projectId, projectRecords] of grouped.entries()) {
    const projectIndexPath = posthogProjectLocalIndexPath(objectType, projectId);
    const projectExistingRows = await readIndex(
      client,
      workspaceId,
      projectIndexPath,
      aggregate,
    );
    const projectRows = new Map(projectExistingRows.map((row) => [row.id, row]));

    for (const record of projectRecords) {
      const objectId = readObjectId(record, objectType);
      if (!objectId) {
        continue;
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
      const canonicalPath = computePostHogPath(objectType, objectId, {
        projectId,
      });
      const title = readObjectTitle(record, objectType, objectId);
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
        continue;
      }

      aggregateRows.set(aggregateId, {
        id: aggregateId,
        title,
        updated: readUpdated(record),
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
        updated: readUpdated(record),
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
    }

    await writeSortedIndex(
      client,
      workspaceId,
      projectIndexPath,
      projectRows,
      aggregate,
    );
  }

  await writeSortedIndex(
    client,
    workspaceId,
    aggregateIndexPath,
    aggregateRows,
    aggregate,
  );
}

function groupByProject(
  records: readonly PostHogRecord[],
): Map<string, PostHogRecord[]> {
  const grouped = new Map<string, PostHogRecord[]>();
  for (const record of records) {
    const projectId = readProjectId(record, "insight");
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
    return readString(record.project_id) ?? readString(record.id);
  }
  return readString(record.project_id) ?? readString(record.projectId);
}

function readObjectId(
  record: PostHogRecord,
  objectType: ProjectScopedObjectType,
): string | undefined {
  if (objectType === "alert-event") {
    return readString(record.id) ?? readString(record.alert_id);
  }
  return readString(record.id);
}

function readProjectTitle(record: PostHogRecord, projectId: string): string {
  return (
    readString(record.name) ??
    readString(record.project_name) ??
    readString(record.slug) ??
    projectId
  );
}

function readObjectTitle(
  record: PostHogRecord,
  objectType: ProjectScopedObjectType,
  objectId: string,
): string {
  switch (objectType) {
    case "insight":
      return (
        readString(record.name) ??
        readString(record.derived_name) ??
        readString(record.short_id) ??
        objectId
      );
    case "dashboard":
      return readString(record.name) ?? readString(record.description) ?? objectId;
    case "feature-flag":
      return readString(record.name) ?? readString(record.key) ?? objectId;
    case "annotation":
      return readString(record.content) ?? readString(record.scope) ?? objectId;
    case "experiment":
      return readString(record.name) ?? readString(record.feature_flag_key) ?? objectId;
    case "survey":
      return readString(record.name) ?? readString(record.type) ?? objectId;
    case "alert-event":
      return readString(record.title) ?? readString(record.event_type) ?? objectId;
  }
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
    default:
      return [];
  }
}

function readUpdated(record: PostHogRecord): string {
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
    new Date().toISOString()
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
): Promise<IndexRow[]> {
  const value = await safeReadJson(client, workspaceId, path, aggregate);
  return Array.isArray(value) ? (value as IndexRow[]) : [];
}

async function readAliasRecord(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<PostHogRecord | null> {
  const value = await safeReadJson(client, workspaceId, path, aggregate);
  if (!isRecord(value)) {
    return null;
  }
  const payload = isRecord(value.payload) ? value.payload : value;
  return payload as PostHogRecord;
}

async function safeReadJson(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<unknown> {
  if (!client.readFile) {
    return null;
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
      return null;
    }
    return JSON.parse(content) as unknown;
  } catch (error) {
    const message = String(error);
    if (
      message.includes("not found") ||
      message.includes("ENOENT") ||
      message.includes("404")
    ) {
      return null;
    }
    aggregate.errors.push({ path, error: message });
    return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
