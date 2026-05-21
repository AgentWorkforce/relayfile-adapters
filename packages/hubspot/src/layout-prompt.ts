export const HUBSPOT_LAYOUT_PROMPT = `# HubSpot Mount Layout

\`/hubspot/\` mirrors HubSpot CRM objects as id-stable JSON files. HubSpot ids
are stable numeric strings; there are no titles to disambiguate, so the
canonical path is the raw id directly.

## Tree

\`\`\`
/hubspot/
├── LAYOUT.md
├── _index.json
├── contacts/
│   ├── _index.json                  ← { id, updated, archived? }
│   ├── <id>.json                    ← canonical contact record
│   └── by-id/<id>.json              ← duplicate canonical record
├── companies/
│   ├── _index.json                  ← { id, updated, archived? }
│   ├── <id>.json                    ← canonical company record
│   └── by-id/<id>.json              ← duplicate canonical record
├── deals/
│   ├── _index.json                  ← { id, updated, archived? }
│   ├── <id>.json                    ← canonical deal record
│   └── by-id/<id>.json              ← duplicate canonical record
└── tickets/
    ├── _index.json                  ← { id, updated, archived? }
    ├── <id>.json                    ← canonical ticket record
    └── by-id/<id>.json              ← duplicate canonical record
\`\`\`

## Indexes

Every object bucket has an \`_index.json\` containing rows with this shape:

\`\`\`json
{ "id": "123456", "updated": "2026-05-21T09:30:00.000Z", "archived": false }
\`\`\`

\`archived\` is omitted when the source record does not carry an archived flag.

## Aliases

The only alias subtree is \`by-id/<id>.json\`. It mirrors the canonical record
and supports lookups by the raw HubSpot id without scanning an index. Because
HubSpot ids are already stable numeric strings, no title, slug, UUID
normalization, or collision suffix is needed.

## Writes

Resolve the numeric id from the bucket \`_index.json\`, then PATCH the matching
HubSpot CRM object:

\`\`\`bash
id=$(jq -r '.[] | select(.id=="123456") | .id' /hubspot/contacts/_index.json)
curl -X PATCH "https://api.hubapi.com/crm/v3/objects/contacts/$id" \\
  -d '{ "properties": { "firstname": "Ada" } }'
\`\`\`

Object routes are:
- contacts: \`PATCH /crm/v3/objects/contacts/<id>\`
- companies: \`PATCH /crm/v3/objects/companies/<id>\`
- deals: \`PATCH /crm/v3/objects/deals/<id>\`
- tickets: \`PATCH /crm/v3/objects/tickets/<id>\`

## Writeback Discovery

Writable models advertise discovery schemas and create examples at:
- \`discovery/hubspot/contacts/.schema.json\`
- \`discovery/hubspot/contacts/.create.example.json\`
- \`discovery/hubspot/companies/.schema.json\`
- \`discovery/hubspot/companies/.create.example.json\`
- \`discovery/hubspot/deals/.schema.json\`
- \`discovery/hubspot/deals/.create.example.json\`
- \`discovery/hubspot/tickets/.schema.json\`
- \`discovery/hubspot/tickets/.create.example.json\`

## Terminal States

Closed deals, where \`properties.dealstage\` starts with \`closed\` such as
\`closedwon\` or \`closedlost\`, remain readable with their status field.
Archived tickets also remain readable. Only an explicit deletion removes the
canonical file, the by-id alias, and the matching index row.
`;

export function hubspotLayoutPromptFile(): {
  path: '/hubspot/LAYOUT.md';
  contentType: 'text/markdown; charset=utf-8';
  content: string;
} {
  return {
    path: '/hubspot/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: HUBSPOT_LAYOUT_PROMPT.endsWith('\n') ? HUBSPOT_LAYOUT_PROMPT : `${HUBSPOT_LAYOUT_PROMPT}\n`,
  };
}
