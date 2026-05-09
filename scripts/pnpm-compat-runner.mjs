import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , target, command] = process.argv;

if (!target || !command) {
  console.error('Usage: node scripts/pnpm-compat-runner.mjs <linear|github> <test|typecheck>');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = path.join(repoRoot, 'packages', target);

function run(bin, args, cwd = packageDir) {
  const result = spawnSync(bin, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

switch (`${target}:${command}`) {
  case 'linear:test':
    run('node', ['--import', 'tsx', '--test', 'src/**/*.test.ts']);
    break;
  case 'linear:typecheck':
    run('npm', ['run', 'typecheck']);
    break;
  case 'github:test':
    run('npm', ['run', 'build']);
    run('node', ['--import', 'tsx', '--test', 'src/**/*.test.ts']);
    break;
  case 'github:typecheck':
    run('npm', ['run', 'typecheck']);
    break;
  default:
    console.error(`Unsupported compatibility target: ${target}:${command}`);
    process.exit(1);
}
