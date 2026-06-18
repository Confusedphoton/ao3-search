import { runPPR, type PPRInput } from './solver';

export type WorkerRequest = {
  requestId: string;
  input: PPRInput;
};

export type WorkerResponse =
  | { requestId: string; result: { authority: number[]; iterations: number; delta: number } }
  | { requestId: string; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, input } = event.data;
  try {
    const result = runPPR(input);
    const response: WorkerResponse = {
      requestId,
      result: {
        authority: [...result.authority],
        iterations: result.iterations,
        delta: result.delta,
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
