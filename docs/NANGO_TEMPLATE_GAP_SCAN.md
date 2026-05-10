# Nango Template Gap Scan

This scan compares the local Nango template corpus under `${NANGO_REPO_ROOT}/integration-templates` with the Relayfile adapter package set. Set `NANGO_REPO_ROOT` to a local Nango checkout, or run the scan from the Nango repository root and resolve `./integration-templates`, so the comparison is reproducible across machines. It is a planning aid for adding future adapters from provider-backed templates.

## Added In This Pass

Confluence was the most direct gap. Nango already ships `confluence` sync templates for `/confluence/spaces` and `/confluence/pages`, Cloud already has `confluence-relay` integration work, and Relayfile did not have a Confluence package. The new `@relayfile/adapter-confluence` package maps spaces and pages under `/confluence`, resolves Confluence Cloud REST API v2 read requests, and turns file-native page writes into `/wiki/api/v2/pages` proxy requests.

## High-Leverage Remaining Candidates

The following Nango templates do not yet have first-class Relayfile adapter packages and have enough structured API shape to be good follow-ups:

| Nango template | Likely Relayfile root | Notes |
|---|---|---|
| `ashby` | `/ashby` | ATS surface. Candidate resources: candidates, applications, jobs, interviews. |
| `bamboohr-basic` | `/bamboohr` | HRIS surface. Candidate resources: employees, time off, company files. |
| `greenhouse-basic` | `/greenhouse` | ATS surface. Candidate resources: candidates, applications, jobs, scorecards. |
| `hibob-service-user` | `/hibob` | HRIS surface. Candidate resources: people, lifecycle events, time off. |
| `kustomer` | `/kustomer` | Support/CRM surface. Candidate resources: customers, conversations, messages. |
| `lever-basic` | `/lever` | ATS surface. Candidate resources: opportunities, postings, candidates, applications. |
| `teamtailor` | `/teamtailor` | ATS surface. Candidate resources: candidates, jobs, departments, applications. |
| `workable` | `/workable` | ATS surface. Candidate resources: candidates, jobs, stages, activities. |
| `zoho-crm` | `/zoho-crm` | CRM surface. Candidate resources: leads, contacts, accounts, deals. |

## Implementation Pattern

For each candidate, use the Nango template models and endpoints to define the read tree first, then add writeback only where the provider API has stable create/update/delete operations that agents can express as JSON files. Keep the source of truth in the adapter package: add `path-mapper.ts`, `queries.ts`, `writeback.ts`, `resources.ts`, discovery schemas/examples, tests, and only then wire Cloud to call the adapter-produced request through the Nango proxy.

The Nango functions remain useful as provider examples and dryrun targets, but file-native Relayfile writes should continue to resolve through adapter-owned logic before reaching Nango.
