export interface RampVfsFile {
  path: string;
  contentType: string;
  content: string;
}

export const RAMP_LAYOUT_PROMPT = `# Ramp Mount Layout

\`/ramp/\` mirrors one Ramp business as finance-readable JSON files, indexes, and lookup aliases. Always inspect the live mount before constructing a path because some canonical records are flat \`<slug>__<id>.json\` files while resources that own child artifacts use \`<id>__<slug>/meta.json\`.

## Tree

\`\`\`
/ramp/
├── LAYOUT.md
├── _index.json
├── business.json
├── bills/
│   ├── _index.json
│   ├── <bill-id>__<invoice-or-vendor-slug>/meta.json
│   ├── by-id/<bill-id>.json
│   ├── by-invoice-number/<invoice-slug>__<bill-id>.json
│   ├── by-vendor/<vendor-slug>/<invoice-slug>__<bill-id>.json
│   └── by-status/<status>/<invoice-slug>__<bill-id>.json
├── purchase-orders/
│   ├── _index.json
│   ├── <po-id>__<number-or-name-slug>/meta.json
│   ├── by-id/<po-id>.json
│   ├── by-number/<number-slug>__<po-id>.json
│   ├── by-vendor/<vendor-slug>/<number-slug>__<po-id>.json
│   └── by-receipt-status/<status>/<number-slug>__<po-id>.json
├── item-receipts/
│   ├── _index.json
│   ├── <receipt-id>__<number-slug>/meta.json
│   ├── by-id/<receipt-id>.json
│   ├── by-number/<number-slug>__<receipt-id>.json
│   └── by-purchase-order/<purchase-order-id>/<number-slug>__<receipt-id>.json
├── vendor-agreements/
│   ├── _index.json
│   ├── <agreement-id>__<name-slug>/meta.json
│   ├── by-id/<agreement-id>.json
│   ├── by-name/<name-slug>__<agreement-id>.json
│   └── by-renewal-status/<status>/<name-slug>__<agreement-id>.json
├── transactions/
│   ├── _index.json
│   ├── <merchant-slug>__<transaction-id>.json
│   ├── by-id/<transaction-id>.json
│   ├── by-merchant/<merchant-slug>/<merchant-slug>__<transaction-id>.json
│   └── by-state/<state>/<merchant-slug>__<transaction-id>.json
├── reimbursements/
│   ├── _index.json
│   ├── <merchant-or-user-slug>__<reimbursement-id>.json
│   ├── by-id/<reimbursement-id>.json
│   ├── by-user/<user-slug>/<merchant-or-user-slug>__<reimbursement-id>.json
│   └── by-state/<state>/<merchant-or-user-slug>__<reimbursement-id>.json
├── receipts/
│   ├── _index.json
│   ├── <transaction-or-reimbursement-slug>__<receipt-id>.json
│   ├── by-id/<receipt-id>.json
│   ├── by-transaction/<transaction-id>/<title-slug>__<receipt-id>.json
│   └── by-reimbursement/<reimbursement-id>/<title-slug>__<receipt-id>.json
├── vendors/
│   ├── _index.json
│   ├── <vendor-slug>__<vendor-id>.json
│   ├── by-id/<vendor-id>.json
│   └── by-name/<vendor-slug>__<vendor-id>.json
├── transfers/
│   ├── _index.json
│   ├── <slug>__<transfer-id>.json
│   └── by-id/<transfer-id>.json
├── repayments/
│   ├── _index.json
│   ├── <slug>__<repayment-id>.json
│   └── by-id/<repayment-id>.json
├── dimensions/
│   ├── entities/_index.json
│   ├── users/_index.json
│   ├── users/by-id/<user-id>.json
│   ├── users/by-email/<email-slug>__<user-id>.json
│   ├── departments/_index.json
│   ├── locations/_index.json
│   ├── merchants/_index.json
│   └── spend-programs/_index.json
└── accounting/
    ├── accounts/_index.json
    └── fields/_index.json
\`\`\`

## Important rules

- Payments are materialized inside bill records. There is intentionally **no** \`/ramp/payments/\` tree because Ramp exposes no public \`payments:*\` scope. If you receive a \`payments.updated\` event, treat it as a bill refresh and resolve it through the bill mount.
- Bills, purchase orders, item receipts, and vendor agreements are directory records because they can own child artifacts. Transactions, reimbursements, receipts, vendors, transfers, repayments, dimensions, and accounting tables stay flat.
- Every resource has an \`_index.json\` sorted by \`updated\` descending. Rows always include \`id\`, \`title\`, \`updated\`, and \`canonicalPath\`. Common finance filters such as bill status, PO receipt status, transaction state, and reimbursement state are kept on the index rows so an agent can filter without opening every record.
- \`by-id/\` aliases are the stable lookup anchor for webhook refreshes and discovery backfills. Human-readable alias trees such as \`by-vendor/\`, \`by-status/\`, \`by-merchant/\`, and \`by-email/\` are convenience lookups layered on top of the canonical record.
- Hookdeck sits in front of Ramp webhook delivery. Expect \`x-ramp-signature\` on forwarded requests and \`x-hookdeck-eventid\` on Hookdeck retries. The two transport-only events, \`webhooks.verification\` and \`tests.test_event\`, do not belong in trigger catalogs and should be handled at ingress instead of materialized as business records.

## Discovery contract

Read the matching discovery schema before writing or generating structured follow-up workflows:

- \`discovery/ramp/business/.schema.json\`
- \`discovery/ramp/bills/.schema.json\`
- \`discovery/ramp/purchase-orders/.schema.json\`
- \`discovery/ramp/item-receipts/.schema.json\`
- \`discovery/ramp/vendor-agreements/.schema.json\`
- \`discovery/ramp/transactions/.schema.json\`
- \`discovery/ramp/reimbursements/.schema.json\`
- \`discovery/ramp/receipts/.schema.json\`
- \`discovery/ramp/vendors/.schema.json\`
- \`discovery/ramp/transfers/.schema.json\`
- \`discovery/ramp/repayments/.schema.json\`
- \`discovery/ramp/entities/.schema.json\`
- \`discovery/ramp/users/.schema.json\`
- \`discovery/ramp/departments/.schema.json\`
- \`discovery/ramp/locations/.schema.json\`
- \`discovery/ramp/merchants/.schema.json\`
- \`discovery/ramp/spend-programs/.schema.json\`
- \`discovery/ramp/accounting-accounts/.schema.json\`
- \`discovery/ramp/accounting-fields/.schema.json\`

Each schema has a sibling \`.create.example.json\` file at the same path root.

## Querying examples

Newest bills with status:
\`\`\`bash
jq '.[] | {title, status, updated}' /ramp/bills/_index.json
\`\`\`

Find paid bills for a vendor:
\`\`\`bash
ls /ramp/bills/by-vendor/acme-inc
jq '.[] | select(.status=="PAID")' /ramp/bills/_index.json
\`\`\`

Open a bill from a webhook lookup alias:
\`\`\`bash
jq '{canonicalPath}' /ramp/bills/by-id/<bill-id>.json
\`\`\`

List transactions by merchant without opening every JSON file:
\`\`\`bash
jq '.[] | {title, state, amount, updated}' /ramp/transactions/_index.json
ls /ramp/transactions/by-merchant
\`\`\`

Resolve a user by email:
\`\`\`bash
ls /ramp/dimensions/users/by-email
jq '{canonicalPath}' /ramp/dimensions/users/by-email/finance-owner__<user-id>.json
\`\`\`

Inspect the discovery surface for future writeback work:
\`\`\`bash
ls /ramp
jq '.[].id' /ramp/_index.json
\`\`\`
`;

export function rampLayoutPromptFile(): RampVfsFile {
  return {
    path: '/ramp/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: RAMP_LAYOUT_PROMPT.endsWith('\n') ? RAMP_LAYOUT_PROMPT : `${RAMP_LAYOUT_PROMPT}\n`,
  };
}
