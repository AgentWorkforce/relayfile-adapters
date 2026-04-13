/**
 * Fix the GitHub publish.yml workflow using the npm provenance persona.
 *
 * Uses the workload-router's usePersona API to invoke the npm-provenance
 * persona to fix .github/workflows/publish.yml to use OIDC trusted publishing
 * instead of NODE_AUTH_TOKEN / NPM_TOKEN secrets.
 *
 * Run with:
 *   agent-relay run workflows/fix-publish-workflow.ts
 */

const { usePersona } = require('@agentworkforce/workload-router');

async function main() {
  const { execute } = usePersona('npm-provenance');

  const result = await execute(
    'Fix .github/workflows/publish.yml to use OIDC npm trusted publishing instead of NODE_AUTH_TOKEN / NPM_TOKEN secrets. Requirements: (1) Remove all NODE_AUTH_TOKEN / NPM_TOKEN secret references — OIDC only. (2) Ensure job permissions include id-token: write and contents: read. (3) Ensure npm publish uses --provenance --access public. (4) Preserve the existing workflow_dispatch inputs (package, version, tag, dry_run) and the multi-package publishing loop. (5) Keep the version bump and git commit steps. Write the fixed file to disk — do not print to stdout.',
    {
      workingDirectory: '.',
      timeoutSeconds: 600,
    }
  );

  console.log('Result:', result.status);
}

main().catch((err) => {
  console.error('Execution failed:', err.message);
  if (err.result) {
    console.error('Result:', err.result);
  }
  process.exit(1);
});
