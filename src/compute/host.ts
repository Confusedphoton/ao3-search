import type {
  PPRInputPayload,
  PPRResultPayload,
  PropagationInputPayload,
  PropagationResultPayload,
} from '../messaging/types';
import { RANK_SIGNAL_ID } from '../propagation';

let worker: Worker | null = null;

const pending = new Map<
  string,
  {
    resolve: (result: PropagationResultPayload) => void;
    reject: (error: Error) => void;
  }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../propagation/propagation.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<{
      requestId: string;
      result?: PropagationResultPayload;
      error?: string;
    }>) => {
      const { requestId, result, error } = event.data;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      if (error) entry.reject(new Error(error));
      else if (result) entry.resolve(result);
      else entry.reject(new Error('Propagation worker returned no result'));
    };
    worker.onerror = (event) => {
      for (const [id, entry] of pending) {
        entry.reject(new Error(event.message ?? 'Propagation worker error'));
        pending.delete(id);
      }
    };
  }
  return worker;
}

export async function runPropagationViaWorker(
  input: PropagationInputPayload,
): Promise<PropagationResultPayload> {
  const requestId = crypto.randomUUID();
  const resultPromise = new Promise<PropagationResultPayload>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });
  getWorker().postMessage({ requestId, input });
  return resultPromise;
}

export async function runPPRViaWorker(input: PPRInputPayload): Promise<PPRResultPayload> {
  const result = await runPropagationViaWorker({
    ...input,
    signalIds: [RANK_SIGNAL_ID],
  });
  return {
    authority: result.signals[RANK_SIGNAL_ID] ?? [],
    iterations: result.iterations,
    delta: result.deltas[RANK_SIGNAL_ID] ?? 0,
  };
}

export async function closeComputeHost(): Promise<void> {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
}
