<!-- prpm:snippet:start @agent-workforce/trail-snippet@1.1.0 -->
# Trail

Record your work as a trajectory for future agents and humans to follow.

## Usage

If `trail` is installed globally, run commands directly:
```bash
trail start "Task description"
```

If not globally installed, use npx to run from local installation:
```bash
npx trail start "Task description"
```

## When Starting Work

Start a trajectory when beginning a task:

```bash
trail start "Implement user authentication"
```

With external task reference:
```bash
trail start "Fix login bug" --task "ENG-123"
```

## Recording Decisions

Record key decisions as you work:

```bash
trail decision "Chose JWT over sessions" \
  --reasoning "Stateless scaling requirements"
```

For minor decisions, reasoning is optional:
```bash
trail decision "Used existing auth middleware"
```

**Record decisions when you:**
- Choose between alternatives
- Make architectural trade-offs
- Decide on an approach after investigation

## Recording Reflections

Periodically step back and synthesize progress:

```bash
trail reflect "Workers aligned on auth approach, API layer progressing well" \
  --confidence 0.8
```

With focal points and adjustments:
```bash
trail reflect "Frontend and backend duplicating validation logic" \
  --focal-points "duplication,ownership" \
  --adjustments "Reassigning validation to backend team" \
  --confidence 0.7
```

**Record reflections when you:**
- Have received several updates and need to synthesize the big picture
- Notice workers or tasks diverging from the plan
- Want to course-correct before continuing
- Are coordinating multiple agents and need to assess overall progress

Reflections differ from decisions: decisions record a specific choice,
reflections record a higher-level synthesis of what's happening and whether
the current approach is working.

## Completing Work

When done, complete with a retrospective:

```bash
trail complete --summary "Added JWT auth with refresh tokens" --confidence 0.85
```

**Confidence levels:**
- 0.9+ : High confidence, well-tested
- 0.7-0.9 : Good confidence, standard implementation
- 0.5-0.7 : Some uncertainty, edge cases possible
- <0.5 : Significant uncertainty, needs review

## Abandoning Work

If you need to stop without completing:

```bash
trail abandon --reason "Blocked by missing API credentials"
```

## Checking Status

View current trajectory:
```bash
trail status
```

## Listing and Viewing Trajectories

List all trajectories:
```bash
trail list
```

View a specific trajectory:
```bash
trail show <trajectory-id>
```

Export a trajectory (markdown, json, timeline, html, pr-summary):
```bash
trail export <trajectory-id> --format markdown
```

## Compacting Trajectories

After a PR merge, compact related trajectories into a single summary:

```bash
trail compact --pr 42
```

Compact by branch:
```bash
trail compact --branch feature/auth
```

Compact by commit range:
```bash
trail compact --commits abc123..def456
```

Compaction consolidates decisions and creates a grouped summary, reducing noise while preserving key decisions.

## Why Trail?

Your trajectory helps others understand:
- **What** you built (commits show this)
- **Why** you built it this way (trajectory shows this)
- **What alternatives** you considered
- **What challenges** you faced

Future agents can query past trajectories to learn from your decisions.
<!-- prpm:snippet:end @agent-workforce/trail-snippet@1.1.0 -->

## Repository conventions

### Do not bump package versions in feature PRs

Versions in `packages/*/package.json` are bumped by the publish phase, not in the PR that introduces the change. The repo's pattern (see `chore(release): bump all (patch)` commits in history) is:

1. Open a feature PR with the source change only — leave `version` fields untouched.
2. After merge, the publish workflow (`.github/workflows/publish.yml`, `workflow_dispatch`) handles the version bump and npm publish.

If you bump a version in a feature PR, downstream consumers (e.g. the `cloud` repo) may pin to a version that hasn't been published yet, breaking installs. Always leave version bumps to the release flow.

### Adding a new adapter package: update `publish.yml`

Any PR that introduces a new directory under `packages/` (e.g. a new adapter like `packages/asana/`) **must also update `.github/workflows/publish.yml`** in the same PR. Two places need to stay in sync:

1. **`inputs.package.options`** — add the new slug to the choice list so it can be selected for one-off publishing.
2. **The "Resolve packages to publish" step** — add the slug to the space-separated `packages=...` list under the `if "all"` branch so it gets included in `package=all` runs.

Without this, the new adapter never publishes to npm. The rest of the test plan can be green and reviewers won't notice — but the package will never appear on the registry, which silently breaks downstream consumers. CI does not verify this; treat it as part of the package-creation checklist.

Quick sanity check before opening the PR (should print nothing and exit 0):

```bash
diff \
  <(ls packages/ | grep -v '^webhook-server$' | sort) \
  <(sed -n '/^      package:/,/^      version:/p' .github/workflows/publish.yml \
    | grep -oE '^ *- [a-z-]+' | sed 's/^ *- //' | grep -v '^all$' | sort -u)
```

`webhook-server` is intentionally excluded (it's a server, not an npm-published adapter). Any other directory under `packages/` that doesn't appear in `publish.yml` is a forgotten registration.

<!-- PRPM_MANIFEST_START -->

<skills_system priority="1">
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills (loaded into main context):
- Use the <path> from the skill entry below
- Invoke: Bash("cat <path>")
- The skill content will load into your current context
- Example: Bash("cat .openskills/backend-architect/SKILL.md")

Usage notes:
- Skills share your context window
- Do not invoke a skill that is already loaded in your context
</usage>

<available_skills>

<skill activation="lazy">
<name>running-headless-orchestrator</name>
<description>Use when an agent needs to self-bootstrap agent-relay and autonomously manage a team of workers - covers infrastructure startup, agent spawning, lifecycle monitoring, and team coordination without human intervention</description>
<path>.openskills/running-headless-orchestrator/SKILL.md</path>
</skill>

<skill activation="lazy">
<name>writing-agent-relay-workflows</name>
<description>Use when building multi-agent workflows with the relay broker-sdk - covers the WorkflowBuilder API, DAG step dependencies, agent definitions, step output chaining via {{steps.X.output}}, verification gates, dedicated channels, swarm patterns, error handling, and event listeners</description>
<path>.openskills/writing-agent-relay-workflows/SKILL.md</path>
</skill>

</available_skills>
</skills_system>

<!-- PRPM_MANIFEST_END -->
