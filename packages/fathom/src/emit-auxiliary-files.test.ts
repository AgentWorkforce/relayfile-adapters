import assert from 'node:assert/strict';
import test from 'node:test';

import { emitFathomAuxiliaryFiles } from './emit-auxiliary-files.js';
import {
  fathomByIdAliasPath,
  fathomMeetingByDayIndexPath,
  fathomMeetingByRecordedByIndexPath,
  fathomMeetingByTeamIndexPath,
  fathomMeetingsIndexPath,
  fathomRecordingSummariesIndexPath,
  fathomRecordingTranscriptsIndexPath,
} from './path-mapper.js';

function makeClient() {
  const files = new Map<string, string>();
  return {
    files,
    async writeFile(input: { workspaceId: string; path: string; content: string; contentType: string }) {
      files.set(input.path, input.content);
    },
    async deleteFile(input: { workspaceId: string; path: string }) {
      files.delete(input.path);
    },
    async readFile(input: { workspaceId: string; path: string }) {
      const content = files.get(input.path);
      if (content === undefined) {
        throw new Error('not found');
      }
      return { content };
    },
  };
}

test('emitFathomAuxiliaryFiles writes meeting tag-style grouped indexes', async () => {
  const client = makeClient();
  await emitFathomAuxiliaryFiles(client, {
    workspaceId: 'rw_test',
    meetings: [
      {
        id: '148996864',
        recording_id: 148996864,
        meeting_title: 'Fathom Demo',
        created_at: '2026-05-22T20:38:43Z',
        recorded_by: {
          email: 'khaliq@agentrelay.com',
          team: 'Sales',
        },
      },
    ],
  });

  const meetingsIndex = JSON.parse(client.files.get(fathomMeetingsIndexPath()) ?? '[]') as Array<Record<string, unknown>>;
  assert.equal(meetingsIndex.length, 1);
  assert.deepEqual(meetingsIndex[0]?.tags, [
    'day:2026-05-22',
    'recorded-by:khaliq@agentrelay.com',
    'team:Sales',
  ]);

  assert.ok(client.files.has(fathomMeetingByDayIndexPath('2026-05-22')));
  assert.ok(client.files.has(fathomMeetingByTeamIndexPath('Sales')));
  assert.ok(client.files.has(fathomMeetingByRecordedByIndexPath('khaliq@agentrelay.com')));
});

test('emitFathomAuxiliaryFiles removes stale grouped indexes after meeting delete', async () => {
  const client = makeClient();
  const workspaceId = 'rw_test';

  await emitFathomAuxiliaryFiles(client, {
    workspaceId,
    meetings: [
      {
        id: '148996864',
        recording_id: 148996864,
        meeting_title: 'Fathom Demo',
        created_at: '2026-05-22T20:38:43Z',
        recorded_by: {
          email: 'khaliq@agentrelay.com',
          team: 'Sales',
        },
      },
    ],
  });

  await emitFathomAuxiliaryFiles(client, {
    workspaceId,
    meetings: [
      {
        id: '148996864',
        _deleted: true,
      },
    ],
  });

  const meetingsIndex = JSON.parse(client.files.get(fathomMeetingsIndexPath()) ?? '[]') as unknown[];
  assert.equal(meetingsIndex.length, 0);
  assert.equal(client.files.has(fathomMeetingByDayIndexPath('2026-05-22')), false);
  assert.equal(client.files.has(fathomMeetingByTeamIndexPath('Sales')), false);
  assert.equal(client.files.has(fathomMeetingByRecordedByIndexPath('khaliq@agentrelay.com')), false);
});

test('emitFathomAuxiliaryFiles anchors meeting artifacts to recording_id when present', async () => {
  const client = makeClient();

  await emitFathomAuxiliaryFiles(client, {
    workspaceId: 'rw_test',
    meetings: [
      {
        id: 'meeting-internal-1',
        recording_id: 148996864,
        meeting_title: 'Fathom Demo',
        created_at: '2026-05-22T20:38:43Z',
      },
    ],
    recordingSummaries: [
      {
        id: 'summary-internal-1',
        recording_id: 148996864,
        created_at: '2026-05-22T20:38:43Z',
      },
    ],
    recordingTranscripts: [
      {
        id: 'transcript-internal-1',
        recording_id: 148996864,
        created_at: '2026-05-22T20:38:43Z',
      },
    ],
  });

  const meetings = JSON.parse(client.files.get(fathomMeetingsIndexPath()) ?? '[]') as Array<Record<string, unknown>>;
  assert.equal(meetings[0]?.id, '148996864');
  assert.equal(meetings[0]?.canonicalPath, '/fathom/meetings/148996864.json');

  const summaries = JSON.parse(client.files.get(fathomRecordingSummariesIndexPath()) ?? '[]') as Array<Record<string, unknown>>;
  assert.equal(summaries[0]?.id, '148996864');
  assert.equal(summaries[0]?.canonicalPath, '/fathom/recordings/148996864/summary.json');

  const transcripts = JSON.parse(client.files.get(fathomRecordingTranscriptsIndexPath()) ?? '[]') as Array<Record<string, unknown>>;
  assert.equal(transcripts[0]?.id, '148996864');
  assert.equal(transcripts[0]?.canonicalPath, '/fathom/recordings/148996864/transcript.json');

  assert.ok(client.files.has(fathomByIdAliasPath('meetings', '148996864')));
  assert.ok(client.files.has(fathomByIdAliasPath('recording-summaries', '148996864')));
  assert.ok(client.files.has(fathomByIdAliasPath('recording-transcripts', '148996864')));
  assert.equal(client.files.has(fathomByIdAliasPath('meetings', 'meeting-internal-1')), false);
  assert.equal(client.files.has(fathomByIdAliasPath('recording-summaries', 'summary-internal-1')), false);
  assert.equal(client.files.has(fathomByIdAliasPath('recording-transcripts', 'transcript-internal-1')), false);
});
