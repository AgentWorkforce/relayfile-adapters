import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from "@relayfile/adapter-core";

import {
  computeNeonPath,
  neonAdvisorIssueByIdAliasPath,
  neonAdvisorIssueByLevelAliasPath,
  neonAdvisorIssueByNameAliasPath,
  neonAdvisorIssueByProjectAliasPath,
  neonAdvisorIssuesIndexPath,
  neonBranchByIdAliasPath,
  neonBranchByProjectAliasPath,
  neonBranchByStateAliasPath,
  neonBranchConsumptionByBranchAliasPath,
  neonBranchConsumptionByIdAliasPath,
  neonBranchConsumptionByMetricAliasPath,
  neonBranchConsumptionIndexPath,
  neonBranchesIndexPath,
  neonEndpointByBranchAliasPath,
  neonEndpointByIdAliasPath,
  neonEndpointByProjectAliasPath,
  neonEndpointByStateAliasPath,
  neonEndpointsIndexPath,
  neonOperationByBranchAliasPath,
  neonOperationByIdAliasPath,
  neonOperationByProjectAliasPath,
  neonOperationByStatusAliasPath,
  neonOperationsIndexPath,
  neonOrganizationByIdAliasPath,
  neonOrganizationsIndexPath,
  neonProjectByIdAliasPath,
  neonProjectByOrgAliasPath,
  neonProjectConsumptionByIdAliasPath,
  neonProjectConsumptionByMetricAliasPath,
  neonProjectConsumptionByProjectAliasPath,
  neonProjectConsumptionIndexPath,
  neonProjectsIndexPath,
  neonRootIndexPath,
  neonSpendingLimitByIdAliasPath,
  neonSpendingLimitsIndexPath,
} from "./path-mapper.js";
import { type NeonPathObjectType } from "./types.js";

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type NeonRecord = Record<string, unknown> & {
  id?: string;
  orgId?: string;
  org_id?: string;
  projectId?: string;
  project_id?: string;
  branchId?: string;
  branch_id?: string;
  endpointId?: string;
  endpoint_id?: string;
  status?: string;
  current_state?: string;
  metric?: string;
  title?: string;
  name?: string;
  displayName?: string;
  issueName?: string;
  level?: string;
  periodStart?: string;
  period_start?: string;
  occurredAt?: string;
  occurred_at?: string;
  updatedAt?: string;
  updated_at?: string;
  createdAt?: string;
  created_at?: string;
  periodEnd?: string;
  period_end?: string;
  capturedAt?: string;
  spending_limit_cents?: number | null;
  _deleted?: true;
};

type IndexRow = {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
} & Record<string, unknown>;

export interface EmitNeonAuxiliaryFilesInput {
  workspaceId: string;
  organizations?: readonly NeonRecord[];
  projects?: readonly NeonRecord[];
  branches?: readonly NeonRecord[];
  endpoints?: readonly NeonRecord[];
  operations?: readonly NeonRecord[];
  projectConsumption?: readonly NeonRecord[];
  branchConsumption?: readonly NeonRecord[];
  spendingLimits?: readonly NeonRecord[];
  advisorIssues?: readonly NeonRecord[];
  connectionId?: string;
}

export async function emitNeonAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitNeonAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await safeWrite(
    client,
    input.workspaceId,
    neonRootIndexPath(),
    `${JSON.stringify(
      [
        { id: "organizations", title: "Organizations", canonicalPath: neonOrganizationsIndexPath() },
        { id: "projects", title: "Projects", canonicalPath: neonProjectsIndexPath() },
        { id: "branches", title: "Branches", canonicalPath: neonBranchesIndexPath() },
        { id: "endpoints", title: "Endpoints", canonicalPath: neonEndpointsIndexPath() },
        { id: "operations", title: "Operations", canonicalPath: neonOperationsIndexPath() },
        { id: "project-consumption", title: "Project Consumption", canonicalPath: neonProjectConsumptionIndexPath() },
        { id: "branch-consumption", title: "Branch Consumption", canonicalPath: neonBranchConsumptionIndexPath() },
        { id: "spending-limits", title: "Spending Limits", canonicalPath: neonSpendingLimitsIndexPath() },
        { id: "advisors", title: "Advisor Issues", canonicalPath: neonAdvisorIssuesIndexPath() },
      ],
      null,
      2,
    )}\n`,
    aggregate,
  );

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "organization",
    indexPath: neonOrganizationsIndexPath(),
    anchorAliasPath: neonOrganizationByIdAliasPath,
    aliasPaths: () => [],
    indexExtras: (record) => compactObject({ handle: readString(record.handle), plan: readString(record.plan) }),
    records: input.organizations ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "project",
    indexPath: neonProjectsIndexPath(),
    anchorAliasPath: neonProjectByIdAliasPath,
    aliasPaths: (record, id) => {
      const orgId = readOrgId(record);
      return orgId ? [neonProjectByOrgAliasPath(orgId, id)] : [];
    },
    indexExtras: (record) =>
      compactObject({
        orgId: readOrgId(record),
        regionId: readString(record.regionId),
        projectState: readString(record.projectState),
      }),
    records: input.projects ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "branch",
    indexPath: neonBranchesIndexPath(),
    anchorAliasPath: neonBranchByIdAliasPath,
    aliasPaths: (record, id) => {
      const aliases: string[] = [];
      const projectId = readProjectId(record);
      if (projectId) aliases.push(neonBranchByProjectAliasPath(projectId, id));
      const state = readBranchState(record);
      if (state) aliases.push(neonBranchByStateAliasPath(state, id));
      return aliases;
    },
    indexExtras: (record) =>
      compactObject({
        projectId: readProjectId(record),
        currentState: readBranchState(record),
        default: readBoolean(record.default),
      }),
    records: input.branches ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "endpoint",
    indexPath: neonEndpointsIndexPath(),
    anchorAliasPath: neonEndpointByIdAliasPath,
    aliasPaths: (record, id) => {
      const aliases: string[] = [];
      const projectId = readProjectId(record);
      const branchId = readBranchId(record);
      const state = readEndpointState(record);
      if (projectId) aliases.push(neonEndpointByProjectAliasPath(projectId, id));
      if (branchId) aliases.push(neonEndpointByBranchAliasPath(branchId, id));
      if (state) aliases.push(neonEndpointByStateAliasPath(state, id));
      return aliases;
    },
    indexExtras: (record) =>
      compactObject({
        projectId: readProjectId(record),
        branchId: readBranchId(record),
        currentState: readEndpointState(record),
        type: readString(record.type),
      }),
    records: input.endpoints ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "operation",
    indexPath: neonOperationsIndexPath(),
    anchorAliasPath: neonOperationByIdAliasPath,
    aliasPaths: (record, id) => {
      const aliases: string[] = [];
      const projectId = readProjectId(record);
      const branchId = readBranchId(record);
      const status = readString(record.status);
      if (projectId) aliases.push(neonOperationByProjectAliasPath(projectId, id));
      if (branchId) aliases.push(neonOperationByBranchAliasPath(branchId, id));
      if (status) aliases.push(neonOperationByStatusAliasPath(status, id));
      return aliases;
    },
    indexExtras: (record) =>
      compactObject({
        projectId: readProjectId(record),
        branchId: readBranchId(record),
        status: readString(record.status),
        action: readString(record.action),
      }),
    records: input.operations ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "project-consumption",
    indexPath: neonProjectConsumptionIndexPath(),
    anchorAliasPath: neonProjectConsumptionByIdAliasPath,
    aliasPaths: (record, id) => {
      const aliases: string[] = [];
      const projectId = readProjectId(record);
      const metric = readString(record.metric);
      if (projectId) aliases.push(neonProjectConsumptionByProjectAliasPath(projectId, id));
      if (metric) aliases.push(neonProjectConsumptionByMetricAliasPath(metric, id));
      return aliases;
    },
    indexExtras: (record) =>
      compactObject({
        projectId: readProjectId(record),
        metric: readString(record.metric),
        periodStart: readPeriodStart(record),
      }),
    records: input.projectConsumption ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "branch-consumption",
    indexPath: neonBranchConsumptionIndexPath(),
    anchorAliasPath: neonBranchConsumptionByIdAliasPath,
    aliasPaths: (record, id) => {
      const aliases: string[] = [];
      const branchId = readBranchId(record);
      const metric = readString(record.metric);
      if (branchId) aliases.push(neonBranchConsumptionByBranchAliasPath(branchId, id));
      if (metric) aliases.push(neonBranchConsumptionByMetricAliasPath(metric, id));
      return aliases;
    },
    indexExtras: (record) =>
      compactObject({
        branchId: readBranchId(record),
        metric: readString(record.metric),
        periodStart: readPeriodStart(record),
      }),
    records: input.branchConsumption ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "spending-limit",
    indexPath: neonSpendingLimitsIndexPath(),
    anchorAliasPath: neonSpendingLimitByIdAliasPath,
    aliasPaths: () => [],
    indexExtras: (record) =>
      compactObject({
        spending_limit_cents:
          typeof record.spending_limit_cents === "number" || record.spending_limit_cents === null
            ? record.spending_limit_cents
            : undefined,
      }),
    records: input.spendingLimits ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  await emitCollection(client, input.workspaceId, {
    provider: "neon",
    objectType: "advisor-issue",
    indexPath: neonAdvisorIssuesIndexPath(),
    anchorAliasPath: neonAdvisorIssueByIdAliasPath,
    aliasPaths: (record, id) => {
      const aliases: string[] = [];
      const projectId = readProjectId(record);
      const level = readString(record.level);
      const issueName = readString(record.issueName) ?? readString(record.name);
      if (projectId) aliases.push(neonAdvisorIssueByProjectAliasPath(projectId, id));
      if (level) aliases.push(neonAdvisorIssueByLevelAliasPath(level, id));
      if (issueName) aliases.push(neonAdvisorIssueByNameAliasPath(issueName, id));
      return aliases;
    },
    indexExtras: (record) =>
      compactObject({
        projectId: readProjectId(record),
        branchId: readBranchId(record),
        level: readString(record.level),
        issueName: readString(record.issueName) ?? readString(record.name),
      }),
    records: input.advisorIssues ?? [],
    connectionId: input.connectionId,
    aggregate,
  });

  return aggregate;
}

interface EmitCollectionOptions {
  provider: string;
  objectType: NeonPathObjectType;
  indexPath: string;
  anchorAliasPath: (id: string) => string;
  aliasPaths: (record: NeonRecord, id: string) => string[];
  indexExtras: (record: NeonRecord) => Record<string, unknown>;
  records: readonly NeonRecord[];
  connectionId: string | undefined;
  aggregate: EmitAuxiliaryFilesResult;
}

async function emitCollection(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  options: EmitCollectionOptions,
): Promise<void> {
  const existingRows = await readIndex(client, workspaceId, options.indexPath, options.aggregate);
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  if (options.records.length === 0 && existingRows.length === 0) {
    await writeIndex(client, workspaceId, options.indexPath, rows, options.aggregate);
    return;
  }

  for (const record of options.records) {
    const id = readId(record);
    if (!id) {
      continue;
    }

    const existingRow = rows.get(id);
    const canonicalPath = computeNeonPath(options.objectType, id);
    const anchorAlias = options.anchorAliasPath(id);
    const previousRecord = await readAliasRecord(client, workspaceId, anchorAlias, options.aggregate);
    const previousAliasPaths = previousRecord ? options.aliasPaths(previousRecord, id) : [];
    const currentAliasPaths = options.aliasPaths(record, id);
    const allAliasPaths = new Set([anchorAlias, ...currentAliasPaths]);
    const title =
      readString(record.title) ??
      readString(record.displayName) ??
      readString(record.name) ??
      readString(record.issueName) ??
      id;
    const updated =
      readString(record.updatedAt) ??
      readString(record.updated_at) ??
      readString(record.occurredAt) ??
      readString(record.occurred_at) ??
      readString(record.periodEnd) ??
      readString(record.period_end) ??
      readString(record.createdAt) ??
      readString(record.created_at) ??
      readString(record.capturedAt) ??
      existingRow?.updated ??
      new Date().toISOString();

    if (record._deleted === true) {
      rows.delete(id);
      for (const alias of new Set([anchorAlias, ...previousAliasPaths, ...currentAliasPaths])) {
        await safeDelete(client, workspaceId, alias, options.aggregate);
      }
      continue;
    }

    rows.set(id, {
      id,
      title,
      updated,
      canonicalPath,
      ...options.indexExtras(record),
    });

    const aliasPayload = buildAliasPayload({
      provider: options.provider,
      objectType: options.objectType,
      objectId: id,
      canonicalPath,
      payload: record,
      ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    });

    for (const staleAlias of previousAliasPaths) {
      if (!allAliasPaths.has(staleAlias)) {
        await safeDelete(client, workspaceId, staleAlias, options.aggregate);
      }
    }

    for (const alias of allAliasPaths) {
      await safeWrite(
        client,
        workspaceId,
        alias,
        `${JSON.stringify(aliasPayload, null, 2)}\n`,
        options.aggregate,
      );
    }
  }

  await writeIndex(client, workspaceId, options.indexPath, rows, options.aggregate);
}

async function readIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<IndexRow[]> {
  if (!client.readFile) {
    return [];
  }

  try {
    const existing = await client.readFile({ workspaceId, path });
    if (!existing) {
      return [];
    }
    const parsed = JSON.parse(existing.content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isIndexRow);
  } catch (error) {
    const status = readStatus(error);
    if (status === 404) {
      return [];
    }
    aggregate.errors.push({ path, error: String(error) });
    return [];
  }
}

async function readAliasRecord(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<NeonRecord | null> {
  if (!client.readFile) {
    return null;
  }

  try {
    const existing = await client.readFile({ workspaceId, path });
    if (!existing) {
      return null;
    }
    const parsed = JSON.parse(existing.content) as Record<string, unknown>;
    const payload = parsed.payload;
    return isRecord(payload) ? (payload as NeonRecord) : null;
  } catch (error) {
    const status = readStatus(error);
    if (status === 404) {
      return null;
    }
    aggregate.errors.push({ path, error: String(error) });
    return null;
  }
}

async function writeIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  rows: Map<string, IndexRow>,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const nextRows = [...rows.values()].sort((left, right) =>
    right.updated.localeCompare(left.updated) || left.id.localeCompare(right.id),
  );
  await safeWrite(
    client,
    workspaceId,
    path,
    `${JSON.stringify(nextRows, null, 2)}\n`,
    aggregate,
  );
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
    aggregate.errors.push({ path, error: String(error) });
  }
}

function buildAliasPayload(input: {
  provider: string;
  objectType: NeonPathObjectType;
  objectId: string;
  canonicalPath: string;
  payload: Record<string, unknown>;
  connectionId?: string;
}): Record<string, unknown> {
  return {
    provider: input.provider,
    objectType: input.objectType,
    objectId: input.objectId,
    canonicalPath: input.canonicalPath,
    payload: input.payload,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  };
}

function readId(record: NeonRecord): string | null {
  const candidate =
    readString(record.id) ??
    readString(record.projectId) ??
    readString(record.project_id) ??
    readString(record.branchId) ??
    readString(record.branch_id) ??
    readString(record.endpointId) ??
    readString(record.endpoint_id) ??
    readString(record.orgId) ??
    readString(record.org_id);
  return candidate ?? null;
}

function readOrgId(record: NeonRecord): string | undefined {
  return readString(record.orgId) ?? readString(record.org_id) ?? undefined;
}

function readProjectId(record: NeonRecord): string | undefined {
  return readString(record.projectId) ?? readString(record.project_id) ?? undefined;
}

function readBranchId(record: NeonRecord): string | undefined {
  return readString(record.branchId) ?? readString(record.branch_id) ?? undefined;
}

function readBranchState(record: NeonRecord): string | undefined {
  return readString(record.current_state) ?? readString(record.status) ?? undefined;
}

function readEndpointState(record: NeonRecord): string | undefined {
  return readString(record.current_state) ?? readString(record.status) ?? undefined;
}

function readPeriodStart(record: NeonRecord): string | undefined {
  return readString(record.periodStart) ?? readString(record.period_start) ?? undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndexRow(value: unknown): value is IndexRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.updated === "string" &&
    typeof value.canonicalPath === "string"
  );
}

function readStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const status = error.status;
  return typeof status === "number" ? status : undefined;
}
