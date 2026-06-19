import { runMultiSignalPropagation, type MultiSignalPropagationInput } from '../propagation';

export type WorkerRequest = {
  requestId: string;
  input: MultiSignalPropagationInput;
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
  | { requestId: string; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, input } = event.data;
  try {
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
