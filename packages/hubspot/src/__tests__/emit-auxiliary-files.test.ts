import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitHubSpotAuxiliaryFiles } from '../emit-auxiliary-files.js';
import type {
  HubSpotCompany,
  HubSpotContact,
  HubSpotDeal,
  HubSpotTicket,
} from '../types.js';

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

interface WriteOnlyCapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  files: Map<string, string>;
}

function createClient(initialFiles: Record<string, string> = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
  const reads: EmitReadInput[] = [];

  return {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input) {
      writes.push(input);
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      deletes.push(input);
      files.delete(input.path);
    },
    async readFile(input): Promise<EmitReadResult | null> {
      reads.push(input);
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    },
  };
}

function createWriteOnlyClient(initialFiles: Record<string, string> = {}): WriteOnlyCapturingClient {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];

  return {
    writes,
    deletes,
    files,
    async writeFile(input) {
      writes.push(input);
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      deletes.push(input);
      files.delete(input.path);
    },
  };
}

type Bucket = 'contacts' | 'companies' | 'deals' | 'tickets';

const CASES = [
  {
    bucket: 'contacts',
    id: '1001',
    title: 'Ada',
    record: {
      id: '1001',
      updatedAt: '2026-05-21T09:00:00.000Z',
      properties: { email: 'ada@example.com', firstname: 'Ada' },
    } satisfies HubSpotContact,
  },
  {
    bucket: 'companies',
    id: '2001',
    title: 'Example',
    record: {
      id: '2001',
      updatedAt: '2026-05-21T10:00:00.000Z',
      properties: { domain: 'example.com', name: 'Example' },
    } satisfies HubSpotCompany,
  },
  {
    bucket: 'deals',
    id: '3001',
    title: 'Expansion',
    record: {
      id: '3001',
      updatedAt: '2026-05-21T11:00:00.000Z',
      properties: { dealname: 'Expansion', dealstage: 'qualifiedtobuy' },
    } satisfies HubSpotDeal,
  },
  {
    bucket: 'tickets',
    id: '4001',
    title: 'Login issue',
    record: {
      id: '4001',
      updatedAt: '2026-05-21T12:00:00.000Z',
      properties: { subject: 'Login issue', hs_pipeline_stage: 'new' },
    } satisfies HubSpotTicket,
  },
] as const;

describe('emitHubSpotAuxiliaryFiles', () => {
  for (const testCase of CASES) {
    it(`writes canonical, by-id alias, and index row for ${testCase.bucket}`, async () => {
      const client = createClient();

      await emitHubSpotAuxiliaryFiles(client, {
        workspaceId: 'ws-1',
        records: { [testCase.bucket]: [testCase.record] },
      });

      const canonical = canonicalPath(testCase.bucket, testCase.id);
      const aliasPath = byIdPath(testCase.bucket, testCase.id);
      const indexPath = bucketIndexPath(testCase.bucket);
      assert.ok(client.files.has('/hubspot/_index.json'));
      assert.ok(client.files.has(canonical));
      assert.equal(client.files.get(aliasPath), client.files.get(canonical));

      const rows = JSON.parse(client.files.get(indexPath) ?? '[]') as Array<{
        id: string;
        title: string;
        updated: string;
        archived?: boolean;
      }>;
      assert.deepEqual(rows, [
        {
          id: testCase.id,
          title: testCase.title,
          updated: testCase.record.updatedAt,
        },
      ]);
    });

    it(`deletes canonical, by-id alias, and index row for ${testCase.bucket} tombstones`, async () => {
      const canonical = canonicalPath(testCase.bucket, testCase.id);
      const alias = byIdPath(testCase.bucket, testCase.id);
      const index = bucketIndexPath(testCase.bucket);
      const client = createClient({
        [canonical]: JSON.stringify({ id: testCase.id }),
        [alias]: JSON.stringify({ id: testCase.id }),
        [index]: JSON.stringify([
          { id: testCase.id, updated: '2026-05-21T09:00:00.000Z' },
          { id: '9999', updated: '2026-05-20T09:00:00.000Z' },
        ]),
      });

      await emitHubSpotAuxiliaryFiles(client, {
        workspaceId: 'ws-1',
        records: { [testCase.bucket]: [{ id: testCase.id, _deleted: true }] },
      });

      const deletedPaths = new Set(client.deletes.map((deleteInput) => deleteInput.path));
      assert.ok(deletedPaths.has(canonical));
      assert.ok(deletedPaths.has(alias));
      assert.equal(client.files.has(canonical), false);
      assert.equal(client.files.has(alias), false);

      const rows = JSON.parse(client.files.get(index) ?? '[]') as Array<{ id: string }>;
      assert.deepEqual(rows.map((row) => row.id), ['9999']);
    });
  }

  it('keeps closed deals readable with status preserved on canonical', async () => {
    const client = createClient();

    await emitHubSpotAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      records: {
        deals: [
          {
            id: '3002',
            properties: { dealname: 'Renewal', dealstage: 'closedwon' },
            updatedAt: '2026-05-21T13:00:00.000Z',
          },
        ],
      },
    });

    const parsed = JSON.parse(client.files.get('/hubspot/deals/3002.json') ?? '{}') as {
      status?: string;
      payload?: { properties?: { dealstage?: string } };
    };
    assert.equal(parsed.status, 'closedwon');
    assert.equal(parsed.payload?.properties?.dealstage, 'closedwon');
    assert.equal(client.files.has('/hubspot/deals/by-id/3002.json'), true);
  });

  it('keeps archived tickets readable', async () => {
    const client = createClient();

    await emitHubSpotAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      records: {
        tickets: [
          {
            id: '4002',
            archived: true,
            properties: { subject: 'Resolved outage', hs_pipeline_stage: 'closed' },
            updatedAt: '2026-05-21T14:00:00.000Z',
          },
        ],
      },
    });

    const parsed = JSON.parse(client.files.get('/hubspot/tickets/4002.json') ?? '{}') as {
      archived?: boolean;
      payload?: { archived?: boolean };
    };
    assert.equal(parsed.archived, true);
    assert.equal(parsed.payload?.archived, true);
    assert.equal(client.files.has('/hubspot/tickets/by-id/4002.json'), true);
  });

  it('uses last write wins for two records with the same id in one batch', async () => {
    const client = createClient();

    await emitHubSpotAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      records: {
        contacts: [
          {
            id: '1002',
            properties: { email: 'first@example.com' },
            updatedAt: '2026-05-21T09:00:00.000Z',
          },
          {
            id: '1002',
            properties: { email: 'second@example.com' },
            updatedAt: '2026-05-21T10:00:00.000Z',
          },
        ],
      },
    });

    const canonical = JSON.parse(client.files.get('/hubspot/contacts/1002.json') ?? '{}') as {
      payload?: { properties?: { email?: string } };
    };
    const alias = JSON.parse(client.files.get('/hubspot/contacts/by-id/1002.json') ?? '{}') as {
      payload?: { properties?: { email?: string } };
    };
    const rows = JSON.parse(client.files.get('/hubspot/contacts/_index.json') ?? '[]') as Array<{
      id: string;
      updated: string;
    }>;

    assert.equal(canonical.payload?.properties?.email, 'second@example.com');
    assert.equal(alias.payload?.properties?.email, 'second@example.com');
    // Both records have no firstname/lastname → contact title falls back to
    // email, and the second (winning) record's email is what lands in the row.
    assert.deepEqual(rows, [
      { id: '1002', title: 'second@example.com', updated: '2026-05-21T10:00:00.000Z' },
    ]);
    assert.equal([...client.files.keys()].filter((path) => path.includes('/by-id/1002.json')).length, 1);
  });

  it('emits canonical + alias + index when client.readFile is unavailable', async () => {
    const client = createWriteOnlyClient();

    const result = await emitHubSpotAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      records: {
        contacts: [CASES[0].record],
        companies: [CASES[1].record],
        deals: [CASES[2].record],
        tickets: [CASES[3].record],
      },
    });

    assert.deepEqual(result.errors, []);
    assert.ok(client.files.has('/hubspot/_index.json'));
    for (const testCase of CASES) {
      const canonical = canonicalPath(testCase.bucket, testCase.id);
      const alias = byIdPath(testCase.bucket, testCase.id);
      const index = bucketIndexPath(testCase.bucket);

      assert.ok(client.files.has(canonical));
      assert.equal(client.files.get(alias), client.files.get(canonical));
      assert.deepEqual(JSON.parse(client.files.get(index) ?? '[]'), [
        {
          id: testCase.id,
          title: testCase.title,
          updated: testCase.record.updatedAt,
        },
      ]);
    }
  });

  // AGENTS.md requires _index.json rows to carry { id, title, updated } at
  // minimum. Title derivation is documented in layout-prompt.ts; this test
  // pins the per-bucket fallback chain (composed name → email → id, etc.).
  it('derives index title per bucket with documented fallbacks', async () => {
    const client = createClient();

    await emitHubSpotAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      records: {
        contacts: [
          {
            id: '7001',
            updatedAt: '2026-05-21T09:00:00.000Z',
            properties: { firstname: 'Grace', lastname: 'Hopper' },
          },
          {
            id: '7002',
            updatedAt: '2026-05-21T09:00:00.000Z',
            properties: { email: 'no-name@example.com' },
          },
          {
            id: '7003',
            updatedAt: '2026-05-21T09:00:00.000Z',
            properties: {},
          },
        ],
        companies: [
          {
            id: '8001',
            updatedAt: '2026-05-21T10:00:00.000Z',
            properties: { domain: 'example.com' },
          },
          {
            id: '8002',
            updatedAt: '2026-05-21T10:00:00.000Z',
            properties: {},
          },
        ],
        deals: [
          {
            id: '9001',
            updatedAt: '2026-05-21T11:00:00.000Z',
            properties: {},
          },
        ],
        tickets: [
          {
            id: '9501',
            updatedAt: '2026-05-21T12:00:00.000Z',
            properties: {},
          },
        ],
      },
    });

    const contactRows = JSON.parse(
      client.files.get('/hubspot/contacts/_index.json') ?? '[]',
    ) as Array<{ id: string; title: string }>;
    const titlesById = new Map(contactRows.map((row) => [row.id, row.title]));
    assert.equal(titlesById.get('7001'), 'Grace Hopper');
    assert.equal(titlesById.get('7002'), 'no-name@example.com');
    assert.equal(titlesById.get('7003'), '7003');

    const companyRows = JSON.parse(
      client.files.get('/hubspot/companies/_index.json') ?? '[]',
    ) as Array<{ id: string; title: string }>;
    const companyTitles = new Map(companyRows.map((row) => [row.id, row.title]));
    assert.equal(companyTitles.get('8001'), 'example.com');
    assert.equal(companyTitles.get('8002'), '8002');

    const dealRows = JSON.parse(
      client.files.get('/hubspot/deals/_index.json') ?? '[]',
    ) as Array<{ id: string; title: string }>;
    assert.equal(dealRows[0]?.title, '9001');

    const ticketRows = JSON.parse(
      client.files.get('/hubspot/tickets/_index.json') ?? '[]',
    ) as Array<{ id: string; title: string }>;
    assert.equal(ticketRows[0]?.title, '9501');
  });
});

function canonicalPath(bucket: Bucket, id: string): string {
  return `/hubspot/${bucket}/${id}.json`;
}

function byIdPath(bucket: Bucket, id: string): string {
  return `/hubspot/${bucket}/by-id/${id}.json`;
}

function bucketIndexPath(bucket: Bucket): string {
  return `/hubspot/${bucket}/_index.json`;
}
