import { describe, expect, it } from 'vitest';
import { resolveEvalPolicy, takePolicyArg } from './cliPolicy';

describe('cliPolicy', () => {
  it('defaults to expected-info', () => {
    expect(resolveEvalPolicy({})).toBe('expected-info');
  });

  it('reads EVAL_POLICY', () => {
    expect(resolveEvalPolicy({ EVAL_POLICY: 'topological' })).toBe('topological');
  });

  it('rejects unknown policies', () => {
    expect(() => resolveEvalPolicy({ EVAL_POLICY: 'beam' })).toThrow(/Invalid EVAL_POLICY/);
  });

  it('parses --policy and -p from argv', () => {
    expect(takePolicyArg(['--policy=topological', '-t', 'small'])).toEqual({
      policy: 'topological',
      rest: ['-t', 'small'],
    });
    expect(takePolicyArg(['-p', 'expected-info', '-t', 'small'])).toEqual({
      policy: 'expected-info',
      rest: ['-t', 'small'],
    });
  });
});
