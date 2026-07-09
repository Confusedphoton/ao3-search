import { runMultiSignalPropagation } from '../propagation';
import { runQueryPropagation } from '../propagation/runQueryPropagation';
import type {
  PropagationInputPayload,
  QueryPropagationInputPayload,
  QueryPropagationResultPayload,
} from '../messaging/types';

export type WorkerInput = PropagationInputPayload | QueryPropagationInputPayload;

export type WorkerRequest = {
  requestId: string;
  input: WorkerInput;
};

export type WorkerResponse =
  | {
      requestId: string;
      result: {
        signals: Record<string, number[]>;
        iterations: number;
        deltas: Record<string, number>;
      };
    }
  | {
      requestId: string;
      result: QueryPropagationResultPayload;
    }
  | { requestId: string; error: string };

function isQueryInput(input: WorkerInput): input is QueryPropagationInputPayload {
  return 'mode' in input && input.mode === 'query';
}

function serializeQueryResult(result: ReturnType<typeof runQueryPropagation>): QueryPropagationResultPayload {
  return {
    relevance: [...result.relevance],
    positiveRelevance: [...result.positiveRelevance],
    negativeRelevance: result.negativeRelevance ? [...result.negativeRelevance] : null,
    authority: [...result.authority],
    precision: [...result.precision],
    expectedInfo: [...result.expectedInfo],
    iterations: { ...result.iterations },
  };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, input } = event.data;
  try {
    if (isQueryInput(input)) {
      const result = runQueryPropagation(input);
      const response: WorkerResponse = {
        requestId,
        result: serializeQueryResult(result),
      };
      self.postMessage(response);
      return;
    }

    const result = runMultiSignalPropagation(input);
    const signals: Record<string, number[]> = {};
    for (const [id, state] of Object.entries(result.signals)) {
      signals[id] = [...state];
    }
    const response: WorkerResponse = {
      requestId,
      result: {
        signals,
        iterations: result.iterations,
        deltas: { ...result.deltas },
      },
    };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

export {};
