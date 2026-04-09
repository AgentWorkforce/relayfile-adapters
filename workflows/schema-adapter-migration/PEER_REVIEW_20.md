# Peer Review: Workflow 20

## Findings

1. [High] The file-writing tasks omit the required disk-write instruction, so they rely only on the agent interpreting "write/create" correctly.

Quote:
`Write a short migration plan to ${PLAN_PATH} (under 60 lines) covering:`

Quote:
`Create ${SDK_INTEGRATION_ADAPTER}. Source schema-adapter.ts:`

Quote:
`Write your verdict to ${REVIEW_PATH}. The first line MUST be exactly`

Rule:
`Rules for file-writing tasks:`
`2. Add IMPORTANT: Write the file to disk. Do NOT output to stdout.`

Why this matters:
The workflow correctly uses `file_exists` for the creation/review artifacts, but the skill requires the explicit write-to-disk instruction as well. Without it, non-interactive agents can still exit cleanly after printing to stdout or misunderstanding the destination.

Fix:
Add `IMPORTANT: Write the file to disk. Do NOT output to stdout.` to `plan-migration`, `write-sdk-integration-adapter`, and `review-migration`.

2. [High] The reviewer is declared as fully pre-injected, but its read permissions still expose the entire SDK and adapter package trees.

Quote:
`// Reviewer is non-interactive — every reviewed file is pre-read by a`
`// deterministic step and injected`

Quote:
`read: [`
`  'relayfile/packages/sdk/typescript/src/**',`
`  'relayfile-adapters/packages/**',`
`  'skills/skills/writing-agent-relay-workflows/**',`
`  PLAN_PATH,`
`]`

Rule:
`Critical rule: Pre-inject content into non-interactive agents. Don't ask them to read large files — pre-read in a deterministic step and inject via {{steps.X.output}}.`

Why this matters:
If the reviewer is supposed to operate only on injected deterministic context, package-wide read access is unnecessary and widens the blast radius. It also weakens the point of the pre-injected review design.

Fix:
Trim `codex-reviewer` read scope to the exact artifacts it actually needs, ideally just the injected review bundle source, the skill text if required, and `REVIEW_PATH` for output.

3. [Medium] The dedup fan-out is not actually maximally parallel because two pairs of independent edits share the same worker agent and will be queued serially.

Quote:
`.agent('codex-impl-dedup-a', {`
`  ...`
`  role: 'Removes the duplicated ... from the GitHub and Slack adapter packages ...'`
`})`

Rule:
`This is the most important design consideration. Sequential workflows waste hours. Always design for maximum parallelism.`

Quote:
`.step('dedup-github-types', {`
`  agent: 'codex-impl-dedup-a',`
`  ...`
`})`

Quote:
`.step('dedup-slack-adapter', {`
`  agent: 'codex-impl-dedup-a',`
`  ...`
`})`

Quote:
`.agent('codex-impl-dedup-b', {`
`  ...`
`  role: 'Removes the duplicated ... from the Linear and Notion adapter packages ...'`
`})`

Rule:
`GOOD — parallel fan-out, merge at the end`
`Steps sharing the same dependsOn run in parallel`

Quote:
`// Every dedup edit depends only on build-adapter-core. The two files in`
`// each pair share the same agent, so the broker queues them serially per`
`// worker`

Why this matters:
The DAG looks parallel on paper, but GitHub/Slack and Linear/Notion are each bound to one worker identity, so those branches cannot execute concurrently in practice.

Fix:
Give each independent dedup file its own worker, or accept explicit sequential ordering instead of describing the branch as real fan-out.

4. [Medium] Several deterministic read steps are unnecessarily serialized behind upstream edits even though the reads themselves have no data dependency.

Quote:
`.step('read-sdk-index', {`
`  type: 'deterministic',`
`  dependsOn: ['write-sdk-integration-adapter'],`
`  command: \`cat ${SDK_INDEX}\`,`
`  ...`
`})`

Quote:
`.step('read-adapter-core-index', {`
`  type: 'deterministic',`
`  dependsOn: ['verify-adapter-core-schema'],`
`  command: \`cat ${ADAPTER_CORE_INDEX}\`,`
`  ...`
`})`

Rule:
`Only add dependsOn when there's a real data dependency`

Why this matters:
Reading `SDK_INDEX` does not depend on the new SDK file already existing, and reading `ADAPTER_CORE_INDEX` does not depend on the schema file edit having finished. These are cheap deterministic reads that can be pulled earlier to shorten the critical path.

Fix:
Start these read steps from the earliest shared prerequisite, then have the corresponding edit step depend on both the read result and the true upstream gate.

5. [Medium] The review branch hands a non-interactive reviewer one giant nine-file source bundle, which is a poor fit for the skill’s bounded-step guidance.

Quote:
`.step('bundle-review-context', {`
`  type: 'deterministic',`
`  ...`
`  command: \`printf '=== %s ===\\n' ${SDK_INTEGRATION_ADAPTER} && cat ${SDK_INTEGRATION_ADAPTER} && ... && cat ${GITLAB_TYPES}\`,`
`  ...`
`})`

Quote:
`.step('review-migration', {`
`  agent: 'codex-reviewer',`
`  dependsOn: ['bundle-review-context'],`
`  task: \`Independent diff review of workflow 20. Reviewed bundle:`
`  {{steps.bundle-review-context.output}}`

Rule:
`One agent, one deliverable. A step's task prompt should be 10-20 lines max.`

Why this matters:
This review is bounded to one verdict file, but the injected context is effectively the full edited surface of the workflow. That increases failure risk and makes the reviewer less reliable than a tighter diff-oriented artifact would.

Fix:
Feed the reviewer a compact review artifact or smaller targeted bundles instead of concatenating all touched files into one injected blob.

## Checked, No Finding

- No hardcoded model strings were found; the workflow uses `ClaudeModels.OPUS`.
- No agent step edits 4+ files. The largest write scopes are two-file worker assignments.
- File-creation steps use `file_exists` verification for `PLAN_20.md`, `integration-adapter.ts`, and `REVIEW_20.md`.
- Code-editing branches do have build gates after edits: SDK, adapter-core, and each adapter package are built.
- No interactive-agent stdout is chained with `{{steps.X.output}}`; chained outputs come from deterministic steps.
- No obvious DAG deadlock pattern appears. Workers do not depend on a lead step that waits on them.
- The adapter-core export instructions correctly preserve `IntegrationAdapter` as a runtime value via `export { IntegrationAdapter }` rather than `export type`.

## Verdict

CHANGES_REQUESTED
