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
  rampLayoutPath,
  rampRootIndexPath,
} from './path-mapper.js';

interface MemoryClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

type ClientOptions = {
  failingReads?: Set<string>;
  withDelete?: boolean;
};

function createClient(
  initialFiles: Record<string, string> = {},
  options: ClientOptions = {},
): MemoryClient {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
  const reads: EmitReadInput[] = [];

  const client: MemoryClient = {
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
      if (options.failingReads?.has(input.path)) {
        throw new Error(`boom:${input.path}`);
      }
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    },
  };

  if (options.withDelete !== false) {
    client.deleteFile = async (input) => {
      deletes.push(input);
      files.delete(input.path);
    };
  }

  return client;
}

test('emitRampAuxiliaryFiles always writes the root index and layout guide', async () => {
  const client = createClient();
  const result = await emitRampAuxiliaryFiles(client, { workspaceId: 'ws_1' });

  assert.deepEqual(result.errors, []);
  assert.equal(client.files.has(rampRootIndexPath()), true);
  assert.equal(client.files.has(rampLayoutPath()), true);
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
  const oldCanonicalPath = '/ramp/bills/bill_1__inv-old/meta.json';
  const client = createClient({
    [oldPointerPath]: JSON.stringify({
      canonicalPath: oldCanonicalPath,
      aliasPaths: [oldPointerPath, oldInvoiceAlias, oldStatusAlias, oldVendorAlias],
    }),
    [oldInvoiceAlias]: '{}',
    [oldStatusAlias]: '{}',
    [oldVendorAlias]: '{}',
    [oldCanonicalPath]: '{}',
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
  assert.ok(!client.files.has(oldCanonicalPath));
  assert.ok(!client.files.has(oldInvoiceAlias));
  assert.ok(!client.files.has(oldStatusAlias));
  assert.ok(!client.files.has(oldVendorAlias));

  const billIndex = JSON.parse(client.files.get(rampIndexPath('bills')) ?? '[]');
  assert.deepEqual(billIndex, [{
    id: 'bill_1',
    title: 'INV-NEW',
    updated: '2026-08-27T15:00:00.000Z',
    canonicalPath: '/ramp/bills/bill%5F1__inv-new/meta.json',
    status: 'PAID',
    vendor_id: 'vendor_1',
  }]);
});

test('emitRampAuxiliaryFiles materializes empty indexes for explicitly synced empty resources', async () => {
  const client = createClient();
  const result = await emitRampAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    receipts: [],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(client.files.get(rampIndexPath('receipts')), '[]\n');
  assert.equal(client.files.has(rampIndexPath('bills')), false);
});

test('emitRampAuxiliaryFiles skips index rewrites when it cannot read the prior index safely', async () => {
  const indexPath = rampIndexPath('bills');
  const oldPointerPath = rampByIdAliasPath('bills', 'bill_1');
  const oldInvoiceAlias = rampBillByInvoiceNumberAliasPath('INV-OLD', 'bill_1', 'INV-OLD');
  const oldCanonicalPath = '/ramp/bills/bill_1__inv-old/meta.json';
  const oldPointerContent = JSON.stringify({
    canonicalPath: oldCanonicalPath,
    aliasPaths: [oldPointerPath, oldInvoiceAlias],
  });
  const client = createClient({
    [oldPointerPath]: oldPointerContent,
    [oldInvoiceAlias]: '{}',
    [oldCanonicalPath]: '{}',
  }, { failingReads: new Set([indexPath]) });

  const result = await emitRampAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    bills: [{
      id: 'bill_1',
      invoice_number: 'INV-NEW',
      vendor: { id: 'vendor_1', name: 'New Vendor' },
      status: 'PAID',
      paid_at: '2026-08-27T15:00:00.000Z',
    }],
  });

  assert.equal(client.files.has(indexPath), false);
  assert.equal(client.files.get(oldPointerPath), oldPointerContent);
  assert.equal(client.files.has(oldInvoiceAlias), true);
  assert.equal(client.files.has(oldCanonicalPath), true);
  assert.deepEqual(client.deletes, []);
  assert.ok(result.errors.some((error) => error.path === indexPath && /Skipped Ramp resource mutation/u.test(error.error)));
});

test('emitRampAuxiliaryFiles ignores unsafe canonical cleanup paths from persisted pointers', async () => {
  const oldPointerPath = rampByIdAliasPath('bills', 'bill_1');
  const client = createClient({
    [oldPointerPath]: JSON.stringify({
      canonicalPath: '/workspace/secrets.txt',
      aliasPaths: [oldPointerPath],
    }),
  });

  const result = await emitRampAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    bills: [{ id: 'bill_1', _deleted: true }],
  });

  assert.equal(client.deletes.some((entry) => entry.path === '/workspace/secrets.txt'), false);
  assert.ok(result.errors.some((error) => /Skipped unsafe Ramp canonicalPath cleanup/u.test(error.error)));
});

test('emitRampAuxiliaryFiles reports deleteFile gaps instead of silently skipping cleanup', async () => {
  const oldPointerPath = rampByIdAliasPath('bills', 'bill_1');
  const client = createClient({
    [oldPointerPath]: JSON.stringify({
      canonicalPath: '/ramp/bills/bill_1__inv-old/meta.json',
      aliasPaths: [oldPointerPath],
    }),
  }, { withDelete: false });

  const result = await emitRampAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    bills: [{ id: 'bill_1', _deleted: true }],
  });

  assert.ok(result.errors.some((error) => /deleteFile not supported by client/u.test(error.error)));
});
