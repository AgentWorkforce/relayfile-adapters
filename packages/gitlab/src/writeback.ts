// @ts-nocheck -- payloads remain runtime-validated so provider input is never implicit.
import { withProxyRetry } from '@relayfile/adapter-core/http';
import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { decodeProjectPath, parseGitLabPath } from './path-mapper.js';
import { resources } from './resources.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

const READ_ONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'url', 'identifier', 'provider', 'objectType', 'objectId', 'workspaceId', 'connectionId', '_webhook', '_connection']);
const ISSUE_FIELDS = ['title', 'description', 'labels', 'assignee_ids', 'milestone_id', 'confidential', 'state_event'];
const MR_FIELDS = ['source_branch', 'target_branch', 'title', 'description', 'labels', 'remove_source_branch', 'draft', 'state_event'];

export class GitLabWritebackHandler {
  constructor(provider, options = {}) { this.provider = provider; this.options = options; }

  extractWritebackTarget(path) {
    const parsed = parseGitLabPath(path);
    if (!parsed) throw unsupported(path);
    const route = classifyWrite(path, resources);
    const meta = parsed.subResource === 'meta.json' || parsed.subResource === 'metadata.json' || parsed.subResource === undefined;
    if (meta && parsed.objectType === 'issues') return { entity: 'issue', projectPath: parsed.projectPath, resourceId: parsed.objectId };
    if (meta && parsed.objectType === 'merge_requests') return { entity: 'merge_request', projectPath: parsed.projectPath, resourceId: parsed.objectId };
    if (route?.resource.name === 'comments' && route.kind === 'create') return { entity: 'issue_note', projectPath: parsed.projectPath, resourceId: parsed.objectId };
    if (route?.resource.name === 'discussions' && route.kind === 'create') return { entity: 'merge_request_discussion', projectPath: parsed.projectPath, resourceId: parsed.objectId };
    throw unsupported(path);
  }

  resolveDeleteRequest(path) { return resolveDeleteRequest(path); }

  async writeBack(workspaceId, path, content) {
    try {
      const request = resolveGitLabWritebackRequest(path, content);
      const response = await withProxyRetry(this.provider).proxy({
        ...request, baseUrl: this.options.baseUrl ?? 'https://gitlab.com',
        connectionId: this.options.connectionId ?? workspaceId,
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.status >= 400) return { success: false, error: `${request.method} ${request.endpoint} failed with ${response.status}` };
      const result = response.data;
      return { success: true, externalId: result?.id ? String(result.id) : result?.iid ? String(result.iid) : undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function resolveGitLabWritebackRequest(path, content) {
  const route = classifyWrite(path, resources);
  if (!route) throw unsupported(path);
  if (route.resource.name === 'issues') {
    if (route.kind === 'create') return { method: 'POST', endpoint: issueEndpoint(collectionProject(path, 'issues')), body: issuePayload(content, true) };
    if (route.kind === 'patch') { const target = canonicalTarget(path, 'issues'); return { method: 'PUT', endpoint: `${issueEndpoint(target.projectPath)}/${target.iid}`, body: issuePayload(content, false) }; }
  }
  if (route.resource.name === 'merge-requests') {
    if (route.kind === 'create') return { method: 'POST', endpoint: mrEndpoint(collectionProject(path, 'merge-requests')), body: mrPayload(content, true) };
    if (route.kind === 'patch') { const target = canonicalTarget(path, 'merge_requests'); return { method: 'PUT', endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}`, body: mrPayload(content, false) }; }
  }
  if (route.resource.name === 'refs' && route.kind === 'create') return { method: 'POST', endpoint: `/api/v4/projects/${projectId(collectionProject(path, 'refs'))}/repository/branches`, body: refPayload(content) };
  if (route.resource.name === 'merge' && route.kind === 'patch') { const target = canonicalTarget(path, 'merge_requests'); return { method: 'PUT', endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}/merge`, body: mergePayload(content) }; }
  if (route.resource.name === 'close-merge-request' && route.kind === 'patch') { const target = canonicalTarget(path, 'merge_requests'); return { method: 'PUT', endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}`, body: statePayload(content) }; }
  if (route.resource.name === 'discussions' && route.kind === 'create') { const target = canonicalTarget(path, 'merge_requests'); const body = payload(content); required(body, 'body', 'GitLab merge request discussion create writeback'); return { method: 'POST', endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}/discussions`, body }; }
  if (route.resource.name === 'comments' && route.kind === 'create') { const target = canonicalTarget(path, 'issues'); const body = payload(content); required(body, 'body', 'GitLab issue note create writeback'); return { method: 'POST', endpoint: `${issueEndpoint(target.projectPath)}/${target.iid}/notes`, body }; }
  throw unsupported(path);
}

export function resolveDeleteRequest(path) {
  const nested = path.match(/^\/gitlab\/projects\/(.+?)\/merge_requests\/([^/]+)\/discussions\/([^/]+)\/notes\/([^/]+)\.json$/);
  if (nested) return { action: 'delete_merge_request_discussion', method: 'DELETE', endpoint: `${mrEndpoint(decodeProjectPath(nested[1]))}/${iid(nested[2])}/discussions/${encodeURIComponent(nested[3])}/notes/${encodeURIComponent(nested[4])}` };
  const parsed = parseGitLabPath(path); const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  if (parsed && route?.resource.name === 'comments' && route.kind === 'delete' && parsed.objectType === 'issues' && parsed.subResourceId) return { action: 'delete_issue_note', method: 'DELETE', endpoint: `${issueEndpoint(parsed.projectPath)}/${parsed.objectId}/notes/${encodeURIComponent(parsed.subResourceId)}` };
  throw new Error(`Unsupported GitLab delete writeback path: ${path}`);
}

function issuePayload(content, creating) {
  const source = typed(content, 'GitLab issue ' + (creating ? 'create' : 'update') + ' payload', ISSUE_FIELDS); const body = {};
  addString(body, source, 'title', creating); addString(body, source, 'description'); labels(body, source); addIntArray(body, source, 'assignee_ids'); addInt(body, source, 'milestone_id'); addBool(body, source, 'confidential'); if (!creating) addState(body, source);
  mutable(body, 'GitLab issue ' + (creating ? 'create' : 'update') + ' payload'); return body;
}

function mrPayload(content, creating) {
  const context = 'GitLab merge request ' + (creating ? 'create' : 'update') + ' payload'; const source = typed(content, context, MR_FIELDS); const body = {};
  for (const field of ['source_branch', 'target_branch', 'title']) addString(body, source, field, creating);
  addString(body, source, 'description'); labels(body, source); addBool(body, source, 'remove_source_branch'); addBool(body, source, 'draft'); if (!creating) addState(body, source); mutable(body, context); return body;
}

function refPayload(content) { const context = 'GitLab branch create payload'; const source = typed(content, context, ['branch', 'ref']); return { branch: required(source, 'branch', context), ref: required(source, 'ref', context) }; }
function mergePayload(content) { const context = 'GitLab merge request merge payload'; const source = typed(content, context, ['merge_commit_message', 'squash', 'should_remove_source_branch']); const body = {}; addString(body, source, 'merge_commit_message'); addBool(body, source, 'squash'); addBool(body, source, 'should_remove_source_branch'); return body; }
function statePayload(content) { const context = 'GitLab merge request close payload'; const source = typed(content, context, ['state_event']); const state_event = required(source, 'state_event', context); if (!['close', 'reopen'].includes(state_event)) throw new Error(`${context}.state_event must be one of close, reopen`); return { state_event }; }

function payload(content) { let value; try { value = JSON.parse(content); } catch (error) { throw new Error(`Invalid GitLab writeback JSON: ${error instanceof Error ? error.message : String(error)}`); } if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitLab writeback payload must be a JSON object'); for (const key of Object.keys(value)) if (READ_ONLY_FIELDS.has(key)) throw new ReadOnlyFieldError(key); return value; }
function typed(content, context, fields) { const value = payload(content); for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`${context}.${key} is not supported`); return value; }
function required(value, key, context) { const field = string(value, key, context); if (!field) throw new Error(`${context}.${key} must be a non-empty string`); return field; }
function string(value, key, context) { const field = value[key]; if (field === undefined) return undefined; if (typeof field !== 'string' || !field.trim()) throw new Error(`${context}.${key} must be a non-empty string`); return field.trim(); }
function addString(body, value, key, requiredValue = false) { const field = string(value, key, `GitLab ${key === 'title' ? 'issue create payload' : 'writeback payload'}`); if (requiredValue && !field) throw new Error(`GitLab ${key === 'title' ? 'issue create payload' : 'merge request create payload'}.${key} must be a non-empty string`); if (field !== undefined) body[key] = field; }
function labels(body, value) { if (value.labels === undefined) return; if (typeof value.labels === 'string' && value.labels.trim()) { body.labels = value.labels.trim(); return; } if (!Array.isArray(value.labels) || value.labels.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('GitLab writeback payload.labels must be a non-empty string or an array of non-empty strings'); body.labels = value.labels.map((item) => item.trim()).join(','); }
function addBool(body, value, key) { if (value[key] === undefined) return; if (typeof value[key] !== 'boolean') throw new Error(`GitLab writeback payload.${key} must be a boolean`); body[key] = value[key]; }
function addInt(body, value, key) { if (value[key] === undefined) return; if (!Number.isInteger(value[key]) || value[key] < 1) throw new Error(`GitLab writeback payload.${key} must be a positive integer`); body[key] = value[key]; }
function addIntArray(body, value, key) { if (value[key] === undefined) return; if (!Array.isArray(value[key]) || value[key].some((item) => !Number.isInteger(item) || item < 1)) throw new Error(`GitLab writeback payload.${key} must be an array of positive integers`); body[key] = value[key]; }
function addState(body, value) { if (value.state_event === undefined) return; if (!['close', 'reopen'].includes(value.state_event)) throw new Error('GitLab writeback payload.state_event must be one of close, reopen'); body.state_event = value.state_event; }
function mutable(body, context) { if (!Object.keys(body).length) throw new Error(`${context} requires at least one mutable field`); }
function collectionProject(path, collection) { const match = path.match(new RegExp(`^/gitlab/projects/(.+?)/${collection}/[^/]+\\.json$`)); if (!match?.[1]) throw unsupported(path); return decodeProjectPath(match[1]); }
function canonicalTarget(path, expected) { const parsed = parseGitLabPath(path); if (!parsed || parsed.objectType !== expected || !/^[1-9]\d*$/.test(parsed.objectId)) throw unsupported(path); return { projectPath: parsed.projectPath, iid: parsed.objectId }; }
function iid(segment) { return decodeURIComponent(segment).split('__')[0]; }
function projectId(projectPath) { return encodeURIComponent(projectPath); }
function issueEndpoint(projectPath) { return `/api/v4/projects/${projectId(projectPath)}/issues`; }
function mrEndpoint(projectPath) { return `/api/v4/projects/${projectId(projectPath)}/merge_requests`; }
function unsupported(path) { return new Error(`Unsupported GitLab writeback path: ${path}. Expected an issue, merge request create/update, branch ref, merge request merge/close, discussion, or issue note.`); }
