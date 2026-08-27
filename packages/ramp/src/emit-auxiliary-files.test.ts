import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from '@relayfile/adapter-core';

import { emitRampAuxiliaryFiles } from './emit-auxiliary-files.js';
import {
  rampBillByInvoiceNumberAliasPath,
  rampBillByStatusAliasPath,
  rampBillByVendorAliasPath,
  rampByIdAliasPath,
  rampIndexPath,
  rampRootIndexPath,
} from './path-mapper.js';

interface MemoryClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

function createClient(initialFiles: Record<string, string> = {}): MemoryClient {
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
    async readFile(input): Promise<EmitReadResult | null> {
      reads.push(input);
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    },
    async deleteFile(input) {
      deletes.push(input);
      files.delete(input.path);
    },
  };
}

test('emitRampAuxiliaryFiles always writes the root index', async () => {
  const client = createClient();
  const result = await emitRampAuxiliaryFiles(client, { workspaceId: 'ws_1' });

  assert.deepEqual(result.errors, []);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0]!.path, rampRootIndexPath());
  assert.deepEqual(JSON.parse(client.files.get(rampRootIndexPath()) ?? '[]')[0], {
    id: 'business',
    title: 'Business',
  });
});

test('emitRampAuxiliaryFiles materializes stable by-id aliases and reconciles stale bill aliases', async () => {
  const oldPointerPath = rampByIdAliasPath('bills', 'bill_1');
  const oldInvoiceAlias = rampBillByInvoiceNumberAliasPath('INV-OLD', 'bill_1', 'INV-OLD');
  const oldStatusAlias = rampBillByStatusAliasPath('APPROVAL_PENDING', 'bill_1', 'INV-OLD');
  const oldVendorAlias = rampBillByVendorAliasPath('Old Vendor', 'bill_1', 'INV-OLD');
  const client = createClient({
    [oldPointerPath]: JSON.stringify({
      aliasPaths: [oldPointerPath, oldInvoiceAlias, oldStatusAlias, oldVendorAlias],
    }),
    [oldInvoiceAlias]: '{}',
    [oldStatusAlias]: '{}',
    [oldVendorAlias]: '{}',
  });

  const result = await emitRampAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    bills: [{
      id: 'bill_1',
      invoice_number: 'INV-NEW',
      vendor: { id: 'vendor_1', name: 'New Vendor' },
      status: 'PAID',
      paid_at: '2026-08-27T15:00:00.000Z',
    }],
  });

  assert.deepEqual(result.errors, []);
  assert.ok(client.files.has(oldPointerPath));
  assert.ok(client.files.has(rampBillByInvoiceNumberAliasPath('INV-NEW', 'bill_1', 'INV-NEW')));
  assert.ok(client.files.has(rampBillByStatusAliasPath('PAID', 'bill_1', 'INV-NEW')));
  assert.ok(client.files.has(rampBillByVendorAliasPath('New Vendor', 'bill_1', 'INV-NEW')));
  assert.ok(!client.files.has(oldInvoiceAlias));
  assert.ok(!client.files.has(oldStatusAlias));
  assert.ok(!client.files.has(oldVendorAlias));

  const billIndex = JSON.parse(client.files.get(rampIndexPath('bills')) ?? '[]');
  assert.deepEqual(billIndex, [{
    id: 'bill_1',
    title: 'INV-NEW',
    updated: '2026-08-27T15:00:00.000Z',
    canonicalPath: '/ramp/bills/bill_1__inv-new/meta.json',
    status: 'PAID',
    vendor_id: 'vendor_1',
  }]);
});
