import type { PPRInputPayload, PPRResultPayload } from '../messaging/types';

let worker: Worker | null = null;

const pending = new Map<
  string,
  {
    resolve: (result: PPRResultPayload) => void;
    reject: (error: Error) => void;
  }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../ppr/ppr.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{
      requestId: string;
      result?: PPRResultPayload;
      error?: string;
    }>) => {
      const { requestId, result, error } = event.data;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      if (error) entry.reject(new Error(error));
      else if (result) entry.resolve(result);
      else entry.reject(new Error('PPR worker returned no result'));
    };
    worker.onerror = (event) => {
      for (const [id, entry] of pending) {
        entry.reject(new Error(event.message ?? 'PPR worker error'));
        pending.delete(id);
      }
    };
  }
  return worker;
}

export async function runPPRViaWorker(input: PPRInputPayload): Promise<PPRResultPayload> {
  const requestId = crypto.randomUUID();
  const resultPromise = new Promise<PPRResultPayload>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });
  getWorker().postMessage({ requestId, input });
  return resultPromise;
}

export async function closeComputeHost(): Promise<void> {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
}
