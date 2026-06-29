import type {
  PPRInputPayload,
  PPRResultPayload,
  PropagationInputPayload,
  PropagationResultPayload,
  QueryPropagationInputPayload,
  QueryPropagationResultPayload,
} from '../messaging/types';
import { RANK_SIGNAL_ID } from '../propagation';

export type WorkerInput = PropagationInputPayload | QueryPropagationInputPayload;

let worker: Worker | null = null;

const signalPending = new Map<
  string,
  {
    resolve: (result: PropagationResultPayload) => void;
    reject: (error: Error) => void;
  }
>();

const queryPending = new Map<
  string,
  {
    resolve: (result: QueryPropagationResultPayload) => void;
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
      result?: PropagationResultPayload | QueryPropagationResultPayload;
      error?: string;
    }>) => {
      const { requestId, result, error } = event.data;
      const signalEntry = signalPending.get(requestId);
      if (signalEntry) {
        signalPending.delete(requestId);
        if (error) signalEntry.reject(new Error(error));
        else if (result && 'signals' in result) signalEntry.resolve(result);
        else signalEntry.reject(new Error('Propagation worker returned no result'));
        return;
      }

      const queryEntry = queryPending.get(requestId);
      if (!queryEntry) return;
      queryPending.delete(requestId);
      if (error) queryEntry.reject(new Error(error));
      else if (result && 'relevance' in result) queryEntry.resolve(result);
      else queryEntry.reject(new Error('Propagation worker returned no result'));
    };
    worker.onerror = (event) => {
      for (const [id, entry] of signalPending) {
        entry.reject(new Error(event.message ?? 'Propagation worker error'));
        signalPending.delete(id);
      }
      for (const [id, entry] of queryPending) {
        entry.reject(new Error(event.message ?? 'Propagation worker error'));
        queryPending.delete(id);
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
    signalPending.set(requestId, { resolve, reject });
  });
  getWorker().postMessage({ requestId, input: { ...input, mode: 'signals' } });
  return resultPromise;
}

export async function runQueryPropagationViaWorker(
  input: Omit<QueryPropagationInputPayload, 'mode'>,
): Promise<QueryPropagationResultPayload> {
  const requestId = crypto.randomUUID();
  const resultPromise = new Promise<QueryPropagationResultPayload>((resolve, reject) => {
    queryPending.set(requestId, { resolve, reject });
  });
  getWorker().postMessage({ requestId, input: { ...input, mode: 'query' } });
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
  signalPending.clear();
  queryPending.clear();
}
