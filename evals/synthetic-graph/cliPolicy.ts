import type { ExpansionPolicyKind } from '@/src/search/expansionPolicy';

export const EVAL_POLICY_KINDS = ['expected-info', 'topological', 'topo-query'] as const;

export const EVAL_POLICY_ENV = 'EVAL_POLICY';

export function isEvalPolicyKind(value: string): value is ExpansionPolicyKind {
  return (EVAL_POLICY_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve the expansion policy for fog-of-war evals.
 * Prefers `EVAL_POLICY` (set by `evals/run-synthetic-graph.mjs --policy=…`).
 */
export function resolveEvalPolicy(
  env: NodeJS.ProcessEnv = process.env,
  fallback: ExpansionPolicyKind = 'expected-info',
): ExpansionPolicyKind {
  const raw = env[EVAL_POLICY_ENV]?.trim();
  if (!raw) return fallback;
  if (!isEvalPolicyKind(raw)) {
    throw new Error(
      `Invalid ${EVAL_POLICY_ENV}="${raw}". Expected one of: ${EVAL_POLICY_KINDS.join(', ')}`,
    );
  }
  return raw;
}

/** Pull `--policy` / `--policy=` out of argv; returns remaining args. */
export function takePolicyArg(argv: string[]): {
  policy: ExpansionPolicyKind | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let policy: ExpansionPolicyKind | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--policy' || arg === '-p') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}. Expected one of: ${EVAL_POLICY_KINDS.join(', ')}`);
      }
      if (!isEvalPolicyKind(value)) {
        throw new Error(`Invalid policy "${value}". Expected one of: ${EVAL_POLICY_KINDS.join(', ')}`);
      }
      policy = value;
      continue;
    }
    if (arg.startsWith('--policy=')) {
      const value = arg.slice('--policy='.length);
      if (!isEvalPolicyKind(value)) {
        throw new Error(`Invalid policy "${value}". Expected one of: ${EVAL_POLICY_KINDS.join(', ')}`);
      }
      policy = value;
      continue;
    }
    rest.push(arg);
  }

  return { policy, rest };
}
