import type { GitHubLabelCall, GitHubLabelDefinition, GitHubLabelRequest, GitHubLabelResponse, GitHubLabelResult } from './labels.types.js';
export type { GitHubLabelAction, GitHubLabelCall, GitHubLabelRequest, GitHubLabelResponse, GitHubLabelResult } from './labels.types.js';

/**
 * Confirm a single label delta without replacing the issue's other labels.
 * The injected proxy supplies credentials. This helper does not retry writes;
 * transport errors propagate because the upstream outcome may be unknown.
 */
export async function confirmGitHubLabelOperation<Response extends GitHubLabelResponse>(call: GitHubLabelCall<Response>): Promise<GitHubLabelResult<Response>> {
  const { request, proxy } = call;
  // Validate before sending the first request.
  switch (request.action) {
    case 'ensure_repository_label':
      return ensureRepositoryLabel(call);
    case 'add_issue_label': {
      const label = issueLabelName(request);
      const response = await proxy(request);
      const confirmed = response.ok && labelNames(response.data)?.has(label.toLowerCase()) === true;
      return result({ request, response, confirmed, reason: 'GitHub issue label add returned an unconfirmed label set' });
    }
    case 'remove_issue_label':
      return removeIssueLabel(call);
    default:
      throw new Error('Unsupported GitHub label action');
  }
}

async function ensureRepositoryLabel<Response extends GitHubLabelResponse>({ request, proxy }: GitHubLabelCall<Response>): Promise<GitHubLabelResult<Response>> {
  const definition = labelDefinition(request.body);
  const response = await proxy(request);
  if (response.status !== 422 || !labelAlreadyExists(response.data)) {
    return result({ request, response, confirmed: response.ok && labelMatches(response.data, definition), reason: 'GitHub repository label ensure returned an unconfirmed label' });
  }

  const endpoint = `${request.endpoint}/${encodeURIComponent(definition.name)}`;
  const existing = await proxy({ ...request, method: 'GET', endpoint, headers: readHeaders(), body: undefined });
  if (!existing.ok || labelMatches(existing.data, definition)) {
    return result({ request, response: existing, confirmed: existing.ok, reason: 'GitHub repository label ensure returned an unconfirmed label' });
  }

  const update: GitHubLabelRequest = { ...request, method: 'PATCH', endpoint, body: { new_name: definition.name, color: definition.color, description: definition.description } };
  const updated = await proxy(update);
  return result({ request: update, response: updated, confirmed: updated.ok && labelMatches(updated.data, definition), reason: 'GitHub repository label update returned an unconfirmed definition' });
}

async function removeIssueLabel<Response extends GitHubLabelResponse>({ request, proxy }: GitHubLabelCall<Response>): Promise<GitHubLabelResult<Response>> {
  const label = issueLabelName(request).toLowerCase();
  const response = await proxy(request);
  if (response.status !== 404) {
    const names = labelNames(response.data);
    return result({ request, response, confirmed: response.ok && names !== undefined && !names.has(label), reason: 'GitHub issue label removal returned an unconfirmed label set' });
  }

  // A DELETE 404 may mean an inaccessible issue; confirm the issue is readable
  // and the label is absent before reporting success.
  const endpoint = request.endpoint.replace(/\/labels\/[^/]+$/u, '');
  const issue = await proxy({ ...request, method: 'GET', endpoint, headers: readHeaders(), body: undefined });
  let names: ReadonlySet<string> | undefined;
  if (isRecord(issue.data)) names = labelNames(issue.data.labels);
  return result({ request, response: issue, confirmed: issue.ok && names !== undefined && !names.has(label), reason: 'GitHub issue label absence was not confirmed' });
}

function result<Response extends GitHubLabelResponse>(input: GitHubLabelResult<Response>): GitHubLabelResult<Response> {
  const { request, response, confirmed, reason } = input;
  if (!confirmed) {
    if (response.ok) return { request, response, confirmed, reason };
    return { request, response, confirmed };
  }
  if (request.action === 'ensure_repository_label' && isRecord(response.data)) {
    const id = response.data.id;
    if (typeof id === 'number' || typeof id === 'string') return { request, response, confirmed, externalId: String(id) };
  }
  return { request, response, confirmed };
}

function labelDefinition(body: unknown): GitHubLabelDefinition {
  if (!isRecord(body)) throw new Error('GitHub repository label request body is missing');
  const name = requiredString(body.name, 'Label name');
  const color = requiredString(body.color, 'Label color').toLowerCase();
  if (!/^[a-f0-9]{6}$/u.test(color)) throw new Error('Label color must be a six-digit hex value');
  if (typeof body.description !== 'string') throw new Error('Label description must be a string');
  return { name, color, description: body.description };
}

function issueLabelName(request: GitHubLabelRequest): string {
  if (request.action === 'add_issue_label') {
    if (!isRecord(request.body) || !Array.isArray(request.body.labels) || request.body.labels.length !== 1) throw new Error('GitHub issue label add requires exactly one label');
    return requiredString(request.body.labels[0], 'Label name');
  }
  const encoded = request.endpoint.match(/\/labels\/([^/]+)$/u)?.[1];
  if (!encoded) throw new Error('GitHub label removal endpoint is missing a label');
  return requiredString(decodeURIComponent(encoded), 'Label name');
}

function labelMatches(value: unknown, definition: GitHubLabelDefinition): boolean {
  if (!isRecord(value)) return false;
  return labelName(value)?.toLowerCase() === definition.name.toLowerCase()
    && typeof value.color === 'string' && value.color.toLowerCase() === definition.color
    && value.description === definition.description;
}

function labelNames(value: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = new Set<string>();
  for (const entry of value) {
    let name = labelName(entry);
    if (typeof entry === 'string') name = entry.trim();
    if (!name) return undefined;
    names.add(name.toLowerCase());
  }
  return names;
}

function labelName(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined;
  return value.name.trim();
}

function labelAlreadyExists(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.errors)) return false;
  return value.errors.some((error: unknown): boolean => isRecord(error) && error.resource === 'Label' && error.code === 'already_exists');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function readHeaders(): Readonly<Record<string, string>> {
  return { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'relayfile-adapter-github' };
}
