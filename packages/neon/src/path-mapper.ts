import { aliasCollisionSuffix, slugifyAlias } from "@relayfile/adapter-core";

import { NEON_PATH_ROOT, type NeonPathObjectType } from "./types.js";

export type NeonNangoModel =
  | "NeonOrganization"
  | "NeonProject"
  | "NeonBranch"
  | "NeonEndpoint"
  | "NeonOperation"
  | "NeonProjectConsumption"
  | "NeonBranchConsumption"
  | "NeonSpendingLimit"
  | "NeonAdvisorIssue";

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Neon ${label} must be a non-empty string`);
  }
  return trimmed;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(assertNonEmpty(value, "path segment"));
}

export function neonRootIndexPath(): string {
  return `${NEON_PATH_ROOT}/_index.json`;
}

export function neonOrganizationPath(id: string): string {
  return `${NEON_PATH_ROOT}/organizations/${encodePathSegment(id)}.json`;
}

export function neonOrganizationsIndexPath(): string {
  return `${NEON_PATH_ROOT}/organizations/_index.json`;
}

export function neonOrganizationByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/organizations/by-id/${encodePathSegment(id)}.json`;
}

export function neonProjectPath(id: string): string {
  return `${NEON_PATH_ROOT}/projects/${encodePathSegment(id)}.json`;
}

export function neonProjectsIndexPath(): string {
  return `${NEON_PATH_ROOT}/projects/_index.json`;
}

export function neonProjectByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/projects/by-id/${encodePathSegment(id)}.json`;
}

export function neonProjectByOrgAliasPath(orgId: string, projectId: string): string {
  return `${NEON_PATH_ROOT}/projects/by-org/${encodePathSegment(slugifyAlias(orgId))}/${encodePathSegment(projectId)}.json`;
}

export function neonBranchPath(id: string): string {
  return `${NEON_PATH_ROOT}/branches/${encodePathSegment(id)}.json`;
}

export function neonBranchesIndexPath(): string {
  return `${NEON_PATH_ROOT}/branches/_index.json`;
}

export function neonBranchByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/branches/by-id/${encodePathSegment(id)}.json`;
}

export function neonBranchByProjectAliasPath(projectId: string, branchId: string): string {
  return `${NEON_PATH_ROOT}/branches/by-project/${encodePathSegment(projectId)}/${encodePathSegment(branchId)}.json`;
}

export function neonBranchByStateAliasPath(state: string, branchId: string): string {
  return `${NEON_PATH_ROOT}/branches/by-state/${encodePathSegment(slugifyAlias(state))}/${encodePathSegment(branchId)}.json`;
}

export function neonEndpointPath(id: string): string {
  return `${NEON_PATH_ROOT}/endpoints/${encodePathSegment(id)}.json`;
}

export function neonEndpointsIndexPath(): string {
  return `${NEON_PATH_ROOT}/endpoints/_index.json`;
}

export function neonEndpointByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/endpoints/by-id/${encodePathSegment(id)}.json`;
}

export function neonEndpointByProjectAliasPath(projectId: string, endpointId: string): string {
  return `${NEON_PATH_ROOT}/endpoints/by-project/${encodePathSegment(projectId)}/${encodePathSegment(endpointId)}.json`;
}

export function neonEndpointByBranchAliasPath(branchId: string, endpointId: string): string {
  return `${NEON_PATH_ROOT}/endpoints/by-branch/${encodePathSegment(branchId)}/${encodePathSegment(endpointId)}.json`;
}

export function neonEndpointByStateAliasPath(state: string, endpointId: string): string {
  return `${NEON_PATH_ROOT}/endpoints/by-state/${encodePathSegment(slugifyAlias(state))}/${encodePathSegment(endpointId)}.json`;
}

export function neonOperationPath(id: string): string {
  return `${NEON_PATH_ROOT}/operations/${encodePathSegment(id)}.json`;
}

export function neonOperationsIndexPath(): string {
  return `${NEON_PATH_ROOT}/operations/_index.json`;
}

export function neonOperationByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/operations/by-id/${encodePathSegment(id)}.json`;
}

export function neonOperationByProjectAliasPath(projectId: string, operationId: string): string {
  return `${NEON_PATH_ROOT}/operations/by-project/${encodePathSegment(projectId)}/${encodePathSegment(operationId)}.json`;
}

export function neonOperationByBranchAliasPath(branchId: string, operationId: string): string {
  return `${NEON_PATH_ROOT}/operations/by-branch/${encodePathSegment(branchId)}/${encodePathSegment(operationId)}.json`;
}

export function neonOperationByStatusAliasPath(status: string, operationId: string): string {
  return `${NEON_PATH_ROOT}/operations/by-status/${encodePathSegment(slugifyAlias(status))}/${encodePathSegment(operationId)}.json`;
}

export function neonProjectConsumptionPath(id: string): string {
  return `${NEON_PATH_ROOT}/consumption/projects/${encodePathSegment(id)}.json`;
}

export function neonProjectConsumptionIndexPath(): string {
  return `${NEON_PATH_ROOT}/consumption/projects/_index.json`;
}

export function neonProjectConsumptionByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/consumption/projects/by-id/${encodePathSegment(id)}.json`;
}

export function neonProjectConsumptionByProjectAliasPath(projectId: string, id: string): string {
  return `${NEON_PATH_ROOT}/consumption/projects/by-project/${encodePathSegment(projectId)}/${encodePathSegment(id)}.json`;
}

export function neonProjectConsumptionByMetricAliasPath(metric: string, id: string): string {
  return `${NEON_PATH_ROOT}/consumption/projects/by-metric/${encodePathSegment(slugifyAlias(metric))}/${encodePathSegment(id)}.json`;
}

export function neonBranchConsumptionPath(id: string): string {
  return `${NEON_PATH_ROOT}/consumption/branches/${encodePathSegment(id)}.json`;
}

export function neonBranchConsumptionIndexPath(): string {
  return `${NEON_PATH_ROOT}/consumption/branches/_index.json`;
}

export function neonBranchConsumptionByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/consumption/branches/by-id/${encodePathSegment(id)}.json`;
}

export function neonBranchConsumptionByBranchAliasPath(branchId: string, id: string): string {
  return `${NEON_PATH_ROOT}/consumption/branches/by-branch/${encodePathSegment(branchId)}/${encodePathSegment(id)}.json`;
}

export function neonBranchConsumptionByMetricAliasPath(metric: string, id: string): string {
  return `${NEON_PATH_ROOT}/consumption/branches/by-metric/${encodePathSegment(slugifyAlias(metric))}/${encodePathSegment(id)}.json`;
}

export function neonSpendingLimitPath(orgId: string): string {
  return `${NEON_PATH_ROOT}/spending-limits/${encodePathSegment(orgId)}.json`;
}

export function neonSpendingLimitsIndexPath(): string {
  return `${NEON_PATH_ROOT}/spending-limits/_index.json`;
}

export function neonSpendingLimitByIdAliasPath(orgId: string): string {
  return `${NEON_PATH_ROOT}/spending-limits/by-id/${encodePathSegment(orgId)}.json`;
}

export function neonAdvisorIssuePath(id: string): string {
  return `${NEON_PATH_ROOT}/advisors/${encodePathSegment(id)}.json`;
}

export function neonAdvisorIssuesIndexPath(): string {
  return `${NEON_PATH_ROOT}/advisors/_index.json`;
}

export function neonAdvisorIssueByIdAliasPath(id: string): string {
  return `${NEON_PATH_ROOT}/advisors/by-id/${encodePathSegment(id)}.json`;
}

export function neonAdvisorIssueByProjectAliasPath(projectId: string, issueId: string): string {
  return `${NEON_PATH_ROOT}/advisors/by-project/${encodePathSegment(projectId)}/${encodePathSegment(issueId)}.json`;
}

export function neonAdvisorIssueByLevelAliasPath(level: string, issueId: string): string {
  return `${NEON_PATH_ROOT}/advisors/by-level/${encodePathSegment(slugifyAlias(level))}/${encodePathSegment(issueId)}.json`;
}

export function neonAdvisorIssueByNameAliasPath(name: string, issueId: string): string {
  const slug = slugifyAlias(name);
  const suffix = aliasCollisionSuffix(issueId);
  return `${NEON_PATH_ROOT}/advisors/by-name/${encodePathSegment(`${slug}-${suffix}__${issueId}`)}.json`;
}

export function normalizeNangoNeonModel(model: string): NeonPathObjectType | null {
  const normalized = model.trim().toLowerCase().replace(/[_\s]+/gu, "-");
  switch (normalized) {
    case "neonorganization":
    case "organization":
    case "organizations":
      return "organization";
    case "neonproject":
    case "project":
    case "projects":
      return "project";
    case "neonbranch":
    case "branch":
    case "branches":
      return "branch";
    case "neonendpoint":
    case "endpoint":
    case "endpoints":
      return "endpoint";
    case "neonoperation":
    case "operation":
    case "operations":
      return "operation";
    case "neonprojectconsumption":
    case "project-consumption":
    case "project-consumptions":
      return "project-consumption";
    case "neonbranchconsumption":
    case "branch-consumption":
    case "branch-consumptions":
      return "branch-consumption";
    case "neonspendinglimit":
    case "spending-limit":
    case "spending-limits":
      return "spending-limit";
    case "neonadvisorissue":
    case "advisor-issue":
    case "advisor-issues":
      return "advisor-issue";
    default:
      return null;
  }
}

export function computeNeonPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeNangoNeonModel(objectType);
  if (!normalizedType) {
    throw new Error(`Unsupported Neon object type: ${objectType}`);
  }

  if (normalizedType === "organization") return neonOrganizationPath(objectId);
  if (normalizedType === "project") return neonProjectPath(objectId);
  if (normalizedType === "branch") return neonBranchPath(objectId);
  if (normalizedType === "endpoint") return neonEndpointPath(objectId);
  if (normalizedType === "operation") return neonOperationPath(objectId);
  if (normalizedType === "project-consumption") return neonProjectConsumptionPath(objectId);
  if (normalizedType === "branch-consumption") return neonBranchConsumptionPath(objectId);
  if (normalizedType === "spending-limit") return neonSpendingLimitPath(objectId);
  return neonAdvisorIssuePath(objectId);
}
