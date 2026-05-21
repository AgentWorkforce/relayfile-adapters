export const HUBSPOT_LAYOUT_PROMPT = `# HubSpot Mount Layout

\`/hubspot/\` mirrors HubSpot CRM objects as id-stable JSON files. HubSpot ids
are stable numeric strings, so the canonical filename is the raw id directly —
no slug, no UUID normalization, no collision suffix.

Always run \`ls\` before constructing a path. The adapter writes
numeric-id filenames (\`/hubspot/<bucket>/<id>.json\`) and you should
inspect the live directory rather than guessing a filename. The
\`_index.json\` in each bucket is the cheapest way to scan a list of ids
with their human-readable titles.

## Tree

\`\`\`
/hubspot/
├── LAYOUT.md                          ← this guide
├── _index.json                        ← bucket roster: [{ id, title }]
├── contacts/
│   ├── _index.json                    ← { id, title, updated, archived? }
│   ├── <id>.json                      ← canonical contact record
│   └── by-id/<id>.json                ← canonical mirror, id-keyed lookup
├── companies/
│   ├── _index.json                    ← { id, title, updated, archived? }
│   ├── <id>.json                      ← canonical company record
│   └── by-id/<id>.json                ← canonical mirror, id-keyed lookup
├── deals/
│   ├── _index.json                    ← { id, title, updated, archived? }
│   ├── <id>.json                      ← canonical deal record
│   └── by-id/<id>.json                ← canonical mirror, id-keyed lookup
└── tickets/
    ├── _index.json                    ← { id, title, updated, archived? }
    ├── <id>.json                      ← canonical ticket record
    └── by-id/<id>.json                ← canonical mirror, id-keyed lookup
\`\`\`

## Indexes

Every object bucket has an \`_index.json\` containing rows with this shape:

\`\`\`json
{
  "id": "123456",
  "title": "Ada Lovelace",
  "updated": "2026-05-21T09:30:00.000Z",
  "archived": false
}
\`\`\`

\`title\` is derived per bucket:
- contacts: \`firstname lastname\`, else \`email\`, else \`id\`
- companies: \`name\`, else \`domain\`, else \`id\`
- deals: \`dealname\`, else \`id\`
- tickets: \`subject\`, else \`id\`

\`archived\` is omitted when the source record does not carry an archived
flag. Rows are sorted by \`updated\` descending.

## Aliases

The only alias subtree is \`by-id/<id>.json\`. It mirrors the canonical record
exactly (full payload, not a minimal pointer) and supports lookups by the raw
HubSpot id without scanning an index. Because HubSpot ids are already stable
numeric strings, no \`by-title\`, \`by-name\`, or other natural-key alias trees
are emitted.

## JSONL And Querying

Indexes are JSON arrays, not JSONL. Use \`ls\`, \`jq\`, and \`grep\` to query
them:

\`\`\`bash
# 1. List every contact id we have
ls /hubspot/contacts/

# 2. Find the id and title of every active (non-archived) deal
jq '.[] | select(.archived != true) | { id, title }' /hubspot/deals/_index.json

# 3. Resolve a deal id from its name
jq -r '.[] | select(.title=="Q3 Enterprise Renewal") | .id' /hubspot/deals/_index.json

# 4. Find every ticket whose canonical payload is in pipeline stage "open"
grep -l '"hs_pipeline_stage":"open"' /hubspot/tickets/*.json

# 5. Pull a record by id via the alias (skips index scan)
jq '.payload.properties' /hubspot/companies/by-id/789.json
\`\`\`

## Writes

Resolve the numeric id from the bucket \`_index.json\` or \`by-id/\` alias,
then PATCH the matching HubSpot CRM object:

\`\`\`bash
id=$(jq -r '.[] | select(.title=="Ada Lovelace") | .id' /hubspot/contacts/_index.json)
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
\`closedwon\` or \`closedlost\`, remain readable with their status field set.
Archived tickets (\`archived: true\`) also remain readable. Only an explicit
deletion removes the canonical file, the \`by-id\` alias, and the matching
index row.
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
