#!/usr/bin/env node
/**
 * Vitest rejects unknown flags, so this wrapper peels off eval-specific flags
 * and forwards the rest to the synthetic-graph eval suite.
 *
 * Usage:
 *   npm run eval:synthetic-graph -- --policy=topological
 *   npm run eval:synthetic-graph -- --policy=topo-query
 *   npm run eval:synthetic-graph -- -p expected-info -t "small corpus"
 *   npm run eval:synthetic-graph -- --no-perturb -t "small corpus"
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const POLICY_KINDS = new Set(['expected-info', 'topological', 'topo-query']);

function takeEvalArgs(argv) {
  const rest = [];
  let policy;
  let perturb;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--policy' || arg === '-p') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) {
        console.error(`Missing value for ${arg}. Expected one of: ${[...POLICY_KINDS].join(', ')}`);
        process.exit(2);
      }
      if (!POLICY_KINDS.has(value)) {
        console.error(`Invalid policy "${value}". Expected one of: ${[...POLICY_KINDS].join(', ')}`);
        process.exit(2);
      }
      policy = value;
      continue;
    }
    if (arg.startsWith('--policy=')) {
      const value = arg.slice('--policy='.length);
      if (!POLICY_KINDS.has(value)) {
        console.error(`Invalid policy "${value}". Expected one of: ${[...POLICY_KINDS].join(', ')}`);
        process.exit(2);
      }
      policy = value;
      continue;
    }
    if (arg === '--no-perturb') {
      perturb = false;
      continue;
    }
    if (arg === '--perturb') {
      perturb = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npm run eval:synthetic-graph -- [options] [vitest args]

Options:
  -p, --policy <kind>   Expansion policy: expected-info (default) | topological | topo-query
  --perturb             Enable measurement noise on the observed graph (default)
  --no-perturb          Disable measurement noise (oracle recovery on the clean graph)
  -h, --help            Show this help

Any other args are passed through to Vitest (e.g. -t "small corpus", -t "warm-start").
`);
      process.exit(0);
    }
    rest.push(arg);
  }
  return { policy, perturb, rest };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { policy, perturb, rest } = takeEvalArgs(process.argv.slice(2));

const env = { ...process.env };
if (policy) env.EVAL_POLICY = policy;
if (perturb !== undefined) env.EVAL_PERTURB = perturb ? '1' : '0';

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--config',
    path.join(root, 'evals', 'vitest.config.ts'),
    '--reporter=verbose',
    ...rest,
  ],
  {
    cwd: root,
    env,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
