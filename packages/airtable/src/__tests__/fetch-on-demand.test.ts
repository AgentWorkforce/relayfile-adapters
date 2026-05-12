import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAirtableFetchOnDemand,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
} from '../index.js';

test('createAirtableFetchOnDemand materializes webhook payloads from the canonical notification path', async () => {
  const requests: ProxyRequest[] = [];
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
      requests.push(request);
      return {
        data: {
          cursor: 7,
          mightHaveMore: false,
          payloadFormat: 'v0',
          payloads: [
            {
              changedTablesById: {
                tbl_tasks: {
                  changedRecordsById: {
                    rec_1: {
                      current: {
                        cellValuesByFieldId: {
                          fld_status: 'Done',
                        },
                      },
                    },
                  },
                },
              },
              timestamp: '2026-05-12T01:00:00.000Z',
            },
          ],
        } as T,
        headers: {},
        status: 200,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  const fetchOnDemand = createAirtableFetchOnDemand(provider, {
    connectionId: 'conn_airtable_1',
    cursor: 4,
    providerConfigKey: 'airtable-primary',
  });
  const materialized = await fetchOnDemand('/airtable/bases/app_base/_notifications/ach_1.json');

  assert.deepEqual(requests[0], {
    baseUrl: '',
    connectionId: 'conn_airtable_1',
    endpoint: '/v0/bases/app_base/webhooks/ach_1/payloads',
    headers: {
      'Provider-Config-Key': 'airtable-primary',
    },
    method: 'GET',
    query: {
      cursor: '4',
    },
  });
  assert.equal(materialized.baseId, 'app_base');
  assert.match(materialized.digest, /^[a-f0-9]{64}$/);
  assert.equal(materialized.webhookId, 'ach_1');
  assert.equal(materialized.notificationId, 'ach_1');
  assert.equal(materialized.cursor, 7);
  assert.equal(materialized.payloadFormat, 'v0');
  assert.deepEqual(materialized.payloads, [
    {
      changedTablesById: {
        tbl_tasks: {
          changedRecordsById: {
            rec_1: {
              current: {
                cellValuesByFieldId: {
                  fld_status: 'Done',
                },
              },
            },
          },
        },
      },
      timestamp: '2026-05-12T01:00:00.000Z',
    },
  ]);
});

test('createAirtableFetchOnDemand follows pagination until the final payload page', async () => {
  const requests: ProxyRequest[] = [];
  const pages = [
    {
      cursor: 8,
      mightHaveMore: true,
      payloads: [
        {
          id: 'page-1',
        },
      ],
    },
    {
      cursor: 9,
      mightHaveMore: false,
      payloadFormat: 'v0',
      payloads: [
        {
          id: 'page-2',
        },
      ],
    },
  ];
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
      requests.push(request);
      const data = pages.shift();
      assert.ok(data, 'expected another Airtable payload page');
      return {
        data: data as T,
        headers: {},
        status: 200,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  const fetchOnDemand = createAirtableFetchOnDemand(provider, {
    connectionId: 'conn_airtable_1',
    cursor: 7,
  });
  const materialized = await fetchOnDemand('/airtable/bases/app_base/_notifications/ach_1.json');

  assert.deepEqual(
    requests.map((request) => request.query),
    [{ cursor: '7' }, { cursor: '8' }],
  );
  assert.deepEqual(materialized.payloads, [{ id: 'page-1' }, { id: 'page-2' }]);
  assert.equal(materialized.cursor, 9);
  assert.equal(materialized.mightHaveMore, false);
});
